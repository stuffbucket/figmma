#!/usr/bin/env node

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { createConnection } from "net";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { IncomingMessage, ServerResponse } from "http";
import {
  getToken as getConfigToken,
  getTeamId as getConfigTeamId,
  setToken as setConfigToken,
  setTeamId as setConfigTeamId,
  configPath,
} from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OBSERVER_PORT = 5183;

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

function extractTeamId(url: string): string | null {
  // Patterns: figma.com/files/team/TEAM_ID/... or figma.com/files/TEAM_ID/...
  const m = url.match(/figma\.com\/files\/(?:team\/)?(\d+)/);
  return m ? m[1] : null;
}

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
    json(res, 200, {
      hasToken: token.length > 0,
      tokenPreview: token.length > 8 ? `${token.slice(0, 8)}…` : "",
      hasTeamId: teamId.length > 0,
      teamId,
      configPath,
    });
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
    if (!teamId && parsed.team_url) {
      teamId = extractTeamId(parsed.team_url) ?? "";
    }
    if (!teamId) {
      json(res, 400, { error: "Could not determine team ID. Provide team_id or a Figma team URL." });
      return;
    }

    // Validate with API if we have a token
    const token = getConfigToken() ?? "";
    if (!token) {
      setConfigTeamId(teamId);
      json(res, 200, { ok: true, teamId, validated: false, message: "Saved but could not validate (no API token configured yet)." });
      return;
    }

    const result = await validateTeamId(token, teamId);
    if (!result.ok) {
      json(res, 400, { error: result.error, teamId });
      return;
    }

    setConfigTeamId(teamId);
    json(res, 200, { ok: true, teamId, validated: true, projects: result.projects });
    return;
  }

  // Default for non-API routes
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("figmma dashboard ws endpoint");
}

// --------------------------------------------------------------------------
// 1. WebSocket server on port 5183 — accepts connections from MCP observers
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
    // --- MCP observer connection ---
    console.log("[dashboard] MCP observer connected");

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
      console.log("[dashboard] MCP observer disconnected");
      const disconnectMsg = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "lifecycle",
        category: "observer",
        summary: "MCP observer disconnected",
      });
      addToHistory(disconnectMsg);
      for (const client of uiClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(disconnectMsg);
        }
      }
    });

    ws.on("error", (err) => {
      console.error("[dashboard] Observer socket error:", err.message);
    });
  }
});

// --------------------------------------------------------------------------
// 2. Serve the web UI — use Vite in dev, or a static build
// --------------------------------------------------------------------------
async function startWebUI(): Promise<void> {
  try {
    // Try to use Vite dev server for a nice dev experience
    const { createServer: createViteServer } = await import("vite");

    const vite = await createViteServer({
      root: resolve(__dirname, "../../dashboard/web"),
      server: { port: 0 }, // dynamic port
      logLevel: "info",
    });

    await vite.listen();
    const address = vite.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : "?";
    console.log(`\n  📺  Dashboard UI: http://localhost:${port}\n`);
  } catch (err) {
    console.error("[dashboard] Could not start Vite dev server:", err);
    console.log(
      "[dashboard] Web UI unavailable — WebSocket relay still active on port",
      OBSERVER_PORT,
    );
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
  const taken = await isPortTaken(OBSERVER_PORT);
  if (taken) {
    console.log(
      `[dashboard] Port ${OBSERVER_PORT} is already in use — another dashboard instance is likely running.`,
    );
    console.log("[dashboard] Kill the other process or connect to the existing dashboard.");
    process.exit(0);
  }

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[dashboard] Port ${OBSERVER_PORT} became unavailable (EADDRINUSE). Is another instance starting up?`,
      );
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(OBSERVER_PORT, "127.0.0.1", () => {
    console.log(`[dashboard] WebSocket relay listening on ws://127.0.0.1:${OBSERVER_PORT}`);
    startWebUI();
  });
}

boot();
