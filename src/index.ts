#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn as spawnChild } from "child_process";
import { createConnection } from "net";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { logger } from "./logger.js";
import { getToken, getTeamId, DASHBOARD_PORT } from "./config.js";
import {
  getMe,
  getCachedUser,
  initializeAuth,
  getTeamProjects,
  getProjectFiles,
  getFileMeta,
  searchProjectFiles,
  getFileComments,
  parseFigmaUrl,
} from "./figma.js";

function resolveTeamId(explicit?: string): string {
  const id = explicit ?? getTeamId();
  if (!id) {
    throw new Error(
      "No team ID provided. Either pass team_id, set FIGMA_TEAM_ID in your MCP client env, or refresh the dashboard page to run setup.",
    );
  }
  return id;
}

const server = new McpServer({
  name: "figmma",
  version: "1.0.0",
});

// Shared tool annotations (MCP spec §Tool Annotations)
const READ_ONLY = {
  title: undefined as string | undefined,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const READ_ONLY_OPEN = {
  ...READ_ONLY,
  openWorldHint: true,
};

// ---------------------------------------------------------------------------
// Helpers — wraps a tool handler with consistent logging & error handling
// ---------------------------------------------------------------------------
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function toolHandler<P>(
  name: string,
  fn: (params: P) => Promise<ToolResult>,
): (params: P) => Promise<ToolResult> {
  return async (params: P) => {
    try {
      return await fn(params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.log("error", name, `Failed: ${msg}`);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  };
}

function text(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }] };
}

// ---------------------------------------------------------------------------
// Tool: get_current_user
// ---------------------------------------------------------------------------
server.tool(
  "get_current_user",
  "See who you're authenticated as in Figma. The user profile is fetched automatically at startup, so this is a quick cached lookup.",
  {},
  { ...READ_ONLY, title: "Get current Figma user" },
  toolHandler("get_current_user", async () => {
    logger.log("tool", "get_current_user", "Tool called — looking up the authenticated Figma user");
    const user = await getMe();
    const msg = [
      `Authenticated as: ${user.handle}`,
      user.email ? `Email: ${user.email}` : null,
      `User ID: ${user.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    logger.log("tool", "get_current_user", `Authenticated as ${user.handle}`, user);
    return text(msg);
  }),
);

// ---------------------------------------------------------------------------
// Tool: parse_figma_url
// ---------------------------------------------------------------------------
server.tool(
  "parse_figma_url",
  "Extract the file key, file name, and node ID from a Figma URL. Use this when a user provides a Figma link instead of a raw file key.",
  {
    url: z.string().describe("A Figma URL (e.g. https://www.figma.com/design/ABC123/My-File)"),
  },
  { ...READ_ONLY, title: "Parse a Figma URL" },
  toolHandler("parse_figma_url", async ({ url }) => {
    logger.log("tool", "parse_figma_url", "Tool called — extracting file key from a Figma URL", { url });
    const parsed = parseFigmaUrl(url);
    if (!parsed) {
      const msg = "Could not parse that URL. Expected a Figma file/design/proto URL.";
      logger.log("error", "parse_figma_url", msg, { url });
      return { content: [{ type: "text", text: msg }], isError: true };
    }

    const lines = [
      `File key: ${parsed.fileKey}`,
      parsed.fileName ? `File name (from URL): ${parsed.fileName}` : null,
      parsed.nodeId ? `Node ID: ${parsed.nodeId}` : null,
    ].filter(Boolean);

    logger.log("tool", "parse_figma_url", `Extracted file key ${parsed.fileKey}`, parsed);
    return text(lines.join("\n"));
  }),
);

// ---------------------------------------------------------------------------
// Tool: list_team_projects
// ---------------------------------------------------------------------------
server.tool(
  "list_team_projects",
  "List all projects in a Figma team. If no team_id is provided, uses the configured default.",
  {
    team_id: z.string().optional().describe("The Figma team ID (optional if configured via setup)"),
  },
  { ...READ_ONLY_OPEN, title: "List team projects" },
  toolHandler("list_team_projects", async ({ team_id: explicitTeamId }) => {
    const team_id = resolveTeamId(explicitTeamId);
    logger.log("tool", "list_team_projects", `Tool called — listing projects in team ${team_id}`, { team_id });
    const projects = await getTeamProjects(team_id);
    if (projects.length === 0) {
      return text(`No projects found in team ${team_id}.`);
    }
    const formatted = projects
      .map((p) => `• ${p.name} (ID: ${p.id})`)
      .join("\n");
    const summary = `${projects.length} project(s) in team ${team_id}:\n\n${formatted}`;
    logger.log("tool", "list_team_projects", `Found ${projects.length} project(s)`, projects);
    return text(summary);
  }),
);

// ---------------------------------------------------------------------------
// Tool: list_project_files
// ---------------------------------------------------------------------------
server.tool(
  "list_project_files",
  "List all files in a Figma project. Use list_team_projects first to find project IDs.",
  {
    project_id: z.string().describe("The Figma project ID (from list_team_projects results)"),
  },
  { ...READ_ONLY_OPEN, title: "List project files" },
  toolHandler("list_project_files", async ({ project_id }) => {
    logger.log("tool", "list_project_files", `Tool called — listing files in project ${project_id}`, { project_id });
    const files = await getProjectFiles(project_id);
    if (files.length === 0) {
      return text(`No files found in project ${project_id}.`);
    }
    const formatted = files
      .map((f) => `• ${f.name}\n  Key: ${f.key}\n  Last modified: ${f.last_modified}`)
      .join("\n\n");
    const summary = `${files.length} file(s) in project ${project_id}:\n\n${formatted}`;
    logger.log("tool", "list_project_files", `Found ${files.length} file(s)`, files);
    return text(summary);
  }),
);

// ---------------------------------------------------------------------------
// Tool: get_file_info
// ---------------------------------------------------------------------------
server.tool(
  "get_file_info",
  "Get metadata about a Figma file (name, last modified, version) without downloading the full document. Accepts a file key or a Figma URL.",
  {
    file_key_or_url: z.string().describe("A Figma file key or a full Figma URL"),
  },
  { ...READ_ONLY_OPEN, title: "Get file metadata" },
  toolHandler("get_file_info", async ({ file_key_or_url }) => {
    let fileKey = file_key_or_url;
    const parsed = parseFigmaUrl(file_key_or_url);
    if (parsed) {
      fileKey = parsed.fileKey;
    }

    logger.log("tool", "get_file_info", `Tool called — fetching metadata for file ${fileKey}`, { file_key: fileKey });
    const meta = await getFileMeta(fileKey);
    const lines = [
      `Name: ${meta.name}`,
      `Last modified: ${meta.lastModified}`,
      `Version: ${meta.version}`,
      meta.editorType ? `Editor: ${meta.editorType}` : null,
      `File key: ${fileKey}`,
    ].filter(Boolean);
    logger.log("tool", "get_file_info", `File: ${meta.name}`, meta);
    return text(lines.join("\n"));
  }),
);

// ---------------------------------------------------------------------------
// Tool: search_projects
// ---------------------------------------------------------------------------
server.tool(
  "search_projects",
  "Search for Figma files by name across all projects in a team. If no team_id is provided, uses the configured default.",
  {
    team_id: z.string().optional().describe("The Figma team ID to search within (optional if configured via setup)"),
    query: z
      .string()
      .describe("Search query to match against file names (case-insensitive substring match)"),
  },
  { ...READ_ONLY_OPEN, title: "Search for files" },
  toolHandler("search_projects", async ({ team_id: explicitTeamId, query }) => {
    const team_id = resolveTeamId(explicitTeamId);
    logger.log("tool", "search_projects", `Tool called — searching for "${query}" across team ${team_id}`, { team_id, query });
    const results = await searchProjectFiles(team_id, query);

    if (results.length === 0) {
      const msg = `No files found matching "${query}" in team ${team_id}.`;
      logger.log("tool", "search_projects", msg);
      return text(msg);
    }

    const formatted = results
      .map((f) =>
        [
          `• ${f.name}`,
          `  Key: ${f.key}`,
          `  Project: ${f.project_name}`,
          `  Last modified: ${f.last_modified}`,
        ].join("\n"),
      )
      .join("\n\n");

    const summary = `Found ${results.length} file(s) matching "${query}":\n\n${formatted}`;
    logger.log("tool", "search_projects", `Found ${results.length} matching file(s)`, results);
    return text(summary);
  }),
);

// ---------------------------------------------------------------------------
// Tool: get_file_comments
// ---------------------------------------------------------------------------
server.tool(
  "get_file_comments",
  "Retrieve all comments on a Figma file. Shows who commented, when, the message content, and whether the comment is resolved. Accepts a file key or a Figma URL.",
  {
    file_key_or_url: z
      .string()
      .describe("The Figma file key or a full Figma URL"),
    as_md: z.boolean().optional().describe("If true, return comment bodies in Markdown format"),
  },
  { ...READ_ONLY_OPEN, title: "Get file comments" },
  toolHandler("get_file_comments", async ({ file_key_or_url, as_md }) => {
    let file_key = file_key_or_url;
    const parsed = parseFigmaUrl(file_key_or_url);
    if (parsed) {
      file_key = parsed.fileKey;
    }

    logger.log("tool", "get_file_comments", `Tool called — fetching comments on file ${file_key}`, { file_key, as_md });
    const comments = await getFileComments(file_key, { as_md });

    if (comments.length === 0) {
      const msg = `No comments found on file ${file_key}.`;
      logger.log("tool", "get_file_comments", msg);
      return text(msg);
    }

    // Separate top-level comments from replies
    const topLevel = comments.filter((c) => !c.parent_id);
    const replies = comments.filter((c) => c.parent_id);
    const replyMap = new Map<string, typeof comments>();
    for (const r of replies) {
      if (!r.parent_id) continue;
      const list = replyMap.get(r.parent_id) ?? [];
      list.push(r);
      replyMap.set(r.parent_id, list);
    }

    const formatted = topLevel
      .map((c) => {
        const status = c.resolved_at ? "✅ Resolved" : "💬 Open";
        const lines = [`[${status}] ${c.user.handle} — ${c.created_at}`, c.message];

        const threadReplies = replyMap.get(c.id);
        if (threadReplies?.length) {
          lines.push("");
          for (const r of threadReplies) {
            lines.push(`  ↳ ${r.user.handle} (${r.created_at}): ${r.message}`);
          }
        }

        return lines.join("\n");
      })
      .join("\n\n---\n\n");

    const summary = `${comments.length} comment(s) on file ${file_key} (${topLevel.length} threads):\n\n${formatted}`;
    logger.log("tool", "get_file_comments", `${topLevel.length} thread(s), ${replies.length} repl(ies)`, {
      threads: topLevel.length,
      replies: replies.length,
      total: comments.length,
    });
    return text(summary);
  }),
);

// ---------------------------------------------------------------------------
// Setup helpers — launch dashboard & browser when no token is configured
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));

function probePort(port: number): Promise<boolean> {
  return new Promise((res) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      res(true);
    });
    sock.on("error", () => res(false));
    sock.setTimeout(500, () => {
      sock.destroy();
      res(false);
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probePort(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function spawnDashboard(): void {
  // In production (installed from tarball), __dirname is dist/ and the
  // compiled server is at dist/dashboard/server.js — run it with node.
  // In development, __dirname is src/ and we need tsx to run .ts files.
  const compiledServer = resolve(__dirname, "dashboard/server.js");
  const isDev = !existsSync(compiledServer);

  const script = isDev
    ? resolve(__dirname, "dashboard/server.ts")
    : compiledServer;
  const args = isDev
    ? ["--import", "tsx/esm", script]
    : [script];

  const child = spawnChild(process.execPath, args, {
    cwd: resolve(__dirname, ".."),
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  child.unref();
}

function openBrowser(url: string): void {
  const plat = process.platform;
  let cmd: string;
  let args: string[];
  if (plat === "darwin") {
    cmd = "open";
    args = [url];
  } else if (plat === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  const child = spawnChild(cmd, args, { stdio: "ignore", detached: true });
  child.unref();
}

async function launchSetup(): Promise<void> {
  logger.log("lifecycle", "setup", "No Figma API token found — opening setup wizard in your browser");

  const dashboardRunning = await probePort(DASHBOARD_PORT);
  if (!dashboardRunning) {
    spawnDashboard();
    const ready = await waitForPort(DASHBOARD_PORT, 15_000);
    if (!ready) {
      logger.log("error", "setup", `Dashboard server failed to start on port ${DASHBOARD_PORT}`);
      return;
    }
  }

  openBrowser(`http://localhost:${DASHBOARD_PORT}/`);
  logger.log(
    "lifecycle",
    "setup",
    "Setup wizard opened in browser — enter your Figma Personal Access Token to get started",
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Log MCP protocol lifecycle events so the dashboard shows connection state
  server.server.oninitialized = () => {
    logger.log(
      "lifecycle",
      "connection",
      "Client connected — session is now active (MCP initialized notification received)",
    );
  };

  server.server.onclose = () => {
    logger.log("lifecycle", "connection", "Client disconnected — session ended");
    logger.destroy();
  };

  // Connect stdio transport FIRST so the MCP client doesn't time out
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Start logger (buffers messages until dashboard is reachable)
  await logger.start();
  logger.log(
    "lifecycle",
    "server",
    "figmma MCP server started — waiting for a client (e.g. VS Code, Claude Desktop) to connect over stdio",
    { name: "figmma", version: "1.0.0", transport: "stdio" },
  );

  // Eagerly fetch & cache the authenticated user profile
  await initializeAuth();
  const user = getCachedUser();
  if (user) {
    logger.log("lifecycle", "auth", `Authenticated as ${user.handle} (${user.email ?? user.id})`, user);
  } else if (!getToken()) {
    // No token at all — launch the dashboard setup wizard & open browser
    await launchSetup();
  }

  logger.log("lifecycle", "server", "Server is ready");
}

main().catch((err) => {
  logger.log("error", "server", `Fatal error: ${err}`);
  process.exit(1);
});
