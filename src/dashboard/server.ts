#!/usr/bin/env node

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { createConnection } from "net";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { IncomingMessage } from "http";

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
// 1. WebSocket server on port 5183 — accepts connections from MCP observers
//    AND from the web UI (differentiated by URL path).
// --------------------------------------------------------------------------
const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("figmma dashboard ws endpoint");
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
