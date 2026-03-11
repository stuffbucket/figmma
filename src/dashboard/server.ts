#!/usr/bin/env node

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { createConnection } from "net";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import type { ChildProcess } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  getToken as getConfigToken,
  getTeamId as getConfigTeamId,
  getOrgId as getConfigOrgId,
  setToken as setConfigToken,
  setTeamId as setConfigTeamId,
  setOrgId as setConfigOrgId,
  configPath,
  DASHBOARD_PORT,
} from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = !existsSync(resolve(__dirname, "web/index.html"));

// Vite dev server URL — set once Vite is ready, used for redirects in dev
let viteUrl: string | null = null;

// Resolved path to the built web assets (populated at boot)
let staticDir: string | null = null;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(res: ServerResponse, urlPath: string): boolean {
  if (!staticDir) return false;

  // Normalize: "/" → "index.html", strip leading slash
  let filePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");

  // Prevent path traversal
  if (filePath.includes("..")) return false;

  const fullPath = resolve(staticDir, filePath);
  // Ensure resolved path is still inside staticDir
  if (!fullPath.startsWith(staticDir)) return false;

  if (!existsSync(fullPath)) {
    // SPA fallback — serve index.html for non-API, non-asset paths
    const ext = extname(filePath);
    if (!ext) {
      filePath = "index.html";
      const indexPath = resolve(staticDir, filePath);
      if (!existsSync(indexPath)) return false;
      const content = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
      return true;
    }
    return false;
  }

  const ext = extname(fullPath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = readFileSync(fullPath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
  return true;
}

// Web UI clients that want to receive log messages
const uiClients = new Set<WebSocket>();

// Recent messages to replay for clients that connect late
const messageHistory: string[] = [];
const MAX_HISTORY = 500;

function addToHistory(raw: string): void {
  messageHistory.push(raw);
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }
}

// --------------------------------------------------------------------------
// Config API helpers
// --------------------------------------------------------------------------
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
      if (body.length > 8192) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

async function validateFigmaToken(
  token: string,
): Promise<{ ok: true; user: { id: string; handle: string; email?: string } } | { ok: false; error: string }> {
  try {
    const res = await fetch("https://api.figma.com/v1/me", {
      headers: { "X-Figma-Token": token },
    });
    if (!res.ok) {
      return { ok: false, error: `Figma responded ${res.status} ${res.statusText}` };
    }
    const user = (await res.json()) as { id: string; handle: string; email?: string };
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function validateTeamId(
  token: string,
  teamId: string,
): Promise<{ ok: true; projects: Array<{ id: string; name: string }> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://api.figma.com/v1/teams/${encodeURIComponent(teamId)}/projects`, {
      headers: { "X-Figma-Token": token },
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Figma responded ${res.status}: ${body}` };
    }
    const data = (await res.json()) as { projects: Array<{ id: string; name: string }> };
    return { ok: true, projects: data.projects };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Parsed components from a Figma URL */
interface FigmaUrlParts {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  fileKey?: string;
}

/** Parse a Figma URL into its component IDs */
function parseFigmaUrl(url: string): FigmaUrlParts {
  const parts: FigmaUrlParts = {};

  // /files/{orgId}/team/{teamId}
  const teamMatch = url.match(/figma\.com\/files\/(\d+)\/team\/(\d+)/);
  if (teamMatch) {
    parts.orgId = teamMatch[1];
    parts.teamId = teamMatch[2];
    return parts;
  }

  // /files/{orgId}/project/{projectId}
  const projectMatch = url.match(/figma\.com\/files\/(\d+)\/project\/(\d+)/);
  if (projectMatch) {
    parts.orgId = projectMatch[1];
    parts.projectId = projectMatch[2];
    return parts;
  }

  // /files/{orgId} (org/workspace root — no team or project)
  const orgMatch = url.match(/figma\.com\/files\/(\d+)(?:\/|$|\?)/);
  if (orgMatch) {
    parts.orgId = orgMatch[1];
    return parts;
  }

  // /design/{fileKey}/... or /file/{fileKey}/... or /proto/{fileKey}/...
  const fileMatch = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)/);
  if (fileMatch) {
    parts.fileKey = fileMatch[1];
    return parts;
  }

  return parts;
}

/** Diagnose a Figma URL and return a helpful message if it can't yield a team ID */
function diagnoseTeamUrl(url: string): string | null {
  const parts = parseFigmaUrl(url);

  if (parts.teamId) return null; // Has a team ID — no problem

  if (parts.fileKey) {
    return "That\u2019s a file URL, not a team URL. Navigate to your team page instead \u2014 the URL should contain /files/{orgId}/team/{teamId}.";
  }
  if (parts.projectId) {
    return `That\u2019s a project URL (org ${parts.orgId}, project ${parts.projectId}). Navigate to the team that owns this project \u2014 the URL should contain /files/{orgId}/team/{teamId}.`;
  }
  if (parts.orgId) {
    return `That\u2019s an organization URL (org ${parts.orgId}), not a team URL. Click a specific team name in the left sidebar \u2014 the URL should contain /files/{orgId}/team/{teamId}.`;
  }
  return null;
}

// --------------------------------------------------------------------------
// MCP Client proxy — spawns an MCP server subprocess for the REPL
// --------------------------------------------------------------------------
let mcpClient: Client | null = null;
let _mcpTransport: StdioClientTransport | null = null;
let mcpChildProcess: ChildProcess | null = null;
let mcpConnecting: Promise<void> | null = null;

async function ensureMcpClient(): Promise<Client> {
  if (mcpClient) return mcpClient;
  if (mcpConnecting) {
    await mcpConnecting;
    if (!mcpClient) throw new Error("MCP client failed to initialize");
    return mcpClient;
  }

  mcpConnecting = (async () => {
    const entryPoint = resolve(__dirname, "../index.ts");
    const projectRoot = resolve(__dirname, "../..");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx/esm", entryPoint],
      cwd: projectRoot,
    });

    const client = new Client({ name: "figmma-repl", version: "1.0.0" });
    await client.connect(transport);

    // Grab the child process reference for cleanup
    mcpChildProcess = (transport as unknown as { _process?: ChildProcess })._process ?? null;

    mcpClient = client;
    _mcpTransport = transport;
  })();

  try {
    await mcpConnecting;
  } finally {
    mcpConnecting = null;
  }
  if (!mcpClient) throw new Error("MCP client failed to initialize");
  return mcpClient;
}

function cleanupMcpClient(): void {
  if (mcpClient) {
    mcpClient.close().catch(() => {});
    mcpClient = null;
  }
  if (mcpChildProcess) {
    mcpChildProcess.kill();
    mcpChildProcess = null;
  }
  _mcpTransport = null;
}

process.on("exit", cleanupMcpClient);
process.on("SIGINT", () => {
  cleanupMcpClient();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupMcpClient();
  process.exit(0);
});

// --------------------------------------------------------------------------
// HTTP request handler
// --------------------------------------------------------------------------
async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // GET /api/config/status — return what's configured
  if (url === "/api/config/status" && req.method === "GET") {
    const token = getConfigToken() ?? "";
    const teamId = getConfigTeamId() ?? "";
    const orgId = getConfigOrgId() ?? "";
    json(res, 200, {
      hasToken: token.length > 0,
      tokenPreview: token.length > 8 ? `${token.slice(0, 8)}\u2026` : "",
      hasTeamId: teamId.length > 0,
      teamId,
      hasOrgId: orgId.length > 0,
      orgId,
      configPath,
    });
    return;
  }

  // GET /api/config/check-token — live-validate the stored token against Figma
  if (url === "/api/config/check-token" && req.method === "GET") {
    const token = getConfigToken() ?? "";
    if (!token) {
      json(res, 200, { valid: false, reason: "no-token" });
      return;
    }
    const result = await validateFigmaToken(token);
    if (result.ok) {
      json(res, 200, { valid: true, user: result.user });
    } else {
      json(res, 200, { valid: false, reason: "invalid", error: result.error });
    }
    return;
  }

  // POST /api/config/token — validate and save PAT
  if (url === "/api/config/token" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: { token?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }
    const token = parsed.token?.trim();
    if (!token) {
      json(res, 400, { error: "Missing 'token' field" });
      return;
    }

    // Figma PATs are ASCII-only — reject non-ASCII input before it hits fetch headers
    if (!/^[\x20-\x7E]+$/.test(token)) {
      json(res, 400, { error: "What you pasted doesn't look like a token to me." });
      return;
    }

    const result = await validateFigmaToken(token);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return;
    }

    setConfigToken(token);
    json(res, 200, { ok: true, user: result.user });
    return;
  }

  // POST /api/config/team — validate and save team ID (from URL or raw ID)
  if (url === "/api/config/team" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: { team_id?: string; team_url?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }

    let teamId = parsed.team_id?.trim() ?? "";
    let orgId: string | undefined;

    if (!teamId && parsed.team_url) {
      const diagnosis = diagnoseTeamUrl(parsed.team_url);
      if (diagnosis) {
        // Even though we can't get a team, save the org if we found one
        const parts = parseFigmaUrl(parsed.team_url);
        if (parts.orgId) {
          setConfigOrgId(parts.orgId);
        }
        json(res, 400, { error: diagnosis, orgId: parts.orgId });
        return;
      }
      const parts = parseFigmaUrl(parsed.team_url);
      teamId = parts.teamId ?? "";
      orgId = parts.orgId;
    }
    if (!teamId) {
      json(res, 400, { error: "Could not determine team ID. Paste a URL like figma.com/files/{orgId}/team/{teamId}, or just the numeric team ID." });
      return;
    }

    // Save org ID if we extracted one
    if (orgId) {
      setConfigOrgId(orgId);
    }

    // Validate with API if we have a token
    const token = getConfigToken() ?? "";
    if (!token) {
      setConfigTeamId(teamId);
      json(res, 200, { ok: true, teamId, orgId, validated: false, message: "Saved but could not validate (no API token configured yet)." });
      return;
    }

    const result = await validateTeamId(token, teamId);
    setConfigTeamId(teamId);
    if (!result.ok) {
      json(res, 200, { ok: true, teamId, orgId, validated: false, warning: result.error });
      return;
    }

    json(res, 200, { ok: true, teamId, orgId, validated: true, projects: result.projects });
    return;
  }

  // GET /api/mcp/tools — list available MCP tools (for REPL)
  if (url === "/api/mcp/tools" && req.method === "GET") {
    try {
      const client = await ensureMcpClient();
      const { tools } = await client.listTools();
      json(res, 200, { tools });
    } catch (err) {
      // Reset client on failure so next request retries
      cleanupMcpClient();
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // POST /api/mcp/call — execute an MCP tool call (for REPL)
  if (url === "/api/mcp/call" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: { name?: string; arguments?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }
    const toolName = parsed.name?.trim();
    if (!toolName) {
      json(res, 400, { error: "Missing 'name' field" });
      return;
    }

    try {
      const client = await ensureMcpClient();
      const result = await client.callTool({
        name: toolName,
        arguments: parsed.arguments ?? {},
      });
      json(res, 200, { result });
    } catch (err) {
      // Reset client on connection failure
      if (err instanceof Error && (err.message.includes("not connected") || err.message.includes("closed"))) {
        cleanupMcpClient();
      }
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // Default: serve static UI or redirect to Vite dev server
  if (viteUrl) {
    res.writeHead(302, { Location: `${viteUrl}${url}` });
    res.end();
    return;
  }

  if (serveStatic(res, url)) return;

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

// --------------------------------------------------------------------------
// 1. WebSocket server on port 5183 — accepts connections from the MCP logger
//    AND from the web UI (differentiated by URL path).
// --------------------------------------------------------------------------
const httpServer = createServer((req, res) => {
  handleHttpRequest(req, res).catch((err) => {
    console.error("[dashboard] HTTP error:", err);
    if (!res.headersSent) {
      json(res, 500, { error: "Internal server error" });
    }
  });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const path = req.url ?? "/";

  if (path === "/ui") {
    // --- Web UI client ---
    uiClients.add(ws);
    // Replay history
    for (const msg of messageHistory) {
      ws.send(msg);
    }
    ws.on("close", () => uiClients.delete(ws));
    ws.on("error", () => uiClients.delete(ws));
  } else {
    // --- MCP server logger connection ---
    console.log("[dashboard] MCP server connected");

    ws.on("message", (data) => {
      const raw = data.toString();
      addToHistory(raw);
      // Fan out to all UI clients
      for (const client of uiClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(raw);
        }
      }
    });

    ws.on("close", () => {
      console.log("[dashboard] MCP server disconnected");
      const disconnectMsg = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "lifecycle",
        category: "connection",
        summary: "MCP server process disconnected from dashboard",
      });
      addToHistory(disconnectMsg);
      for (const client of uiClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(disconnectMsg);
        }
      }
    });

    ws.on("error", (err) => {
      console.error("[dashboard] Logger socket error:", err.message);
    });
  }
});

// --------------------------------------------------------------------------
// 2. Serve the web UI — Vite dev server in development, static files otherwise
// --------------------------------------------------------------------------
async function startWebUI(): Promise<void> {
  if (isDev) {
    // Development: start Vite dev server for HMR
    try {
      const { createServer: createViteServer } = await import("vite");

      const vite = await createViteServer({
        root: resolve(__dirname, "../../dashboard/web"),
        server: { port: 0 },
        logLevel: "info",
      });

      await vite.listen();
      const address = vite.httpServer?.address();
      const port = typeof address === "object" && address ? address.port : "?";
      viteUrl = `http://localhost:${port}`;
      console.log(`\n  📺  Dashboard UI: ${viteUrl}\n`);
      console.log(`     (also accessible via http://localhost:${DASHBOARD_PORT}/)\n`);
    } catch (err) {
      console.error("[dashboard] Could not start Vite dev server:", err);
      console.log(
        "[dashboard] Web UI unavailable — WebSocket relay still active on port",
        DASHBOARD_PORT,
      );
    }
  } else {
    // Production: serve pre-built static files
    staticDir = resolve(__dirname, "web");
    console.log(`\n  📺  Dashboard UI: http://localhost:${DASHBOARD_PORT}/\n`);
  }
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

/** Check if the port is already in use by probing it */
function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function boot(): Promise<void> {
  const taken = await isPortTaken(DASHBOARD_PORT);
  if (taken) {
    console.log(
      `[dashboard] Port ${DASHBOARD_PORT} is already in use — another dashboard instance is likely running.`,
    );
    console.log("[dashboard] Kill the other process or connect to the existing dashboard.");
    process.exit(0);
  }

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[dashboard] Port ${DASHBOARD_PORT} became unavailable (EADDRINUSE). Is another instance starting up?`,
      );
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(DASHBOARD_PORT, "127.0.0.1", () => {
    console.log(`[dashboard] WebSocket relay listening on ws://127.0.0.1:${DASHBOARD_PORT}`);
    startWebUI();
  });
}

boot();
