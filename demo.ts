#!/usr/bin/env tsx
/**
 * Demo driver — spawns the MCP server and sends a sequence of tool calls
 * so you can watch them appear in the dashboard UI at http://localhost:5173
 */
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

const child = spawn("npx", ["tsx", resolve(__dirname, "src/index.ts")], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dirname,
});

let msgId = 0;

function send(obj: Record<string, unknown>): void {
  const body = JSON.stringify({ jsonrpc: "2.0", ...obj });
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  child.stdin!.write(header + body);
}

// Parse JSON-RPC responses from stdout (Content-Length framed)
const rl = readline.createInterface({ input: child.stdout! });
let contentLength = 0;
let accum = "";

child.stdout!.on("data", (chunk: Buffer) => {
  accum += chunk.toString();
  while (true) {
    if (contentLength === 0) {
      const headerEnd = accum.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = accum.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (match) contentLength = parseInt(match[1], 10);
      accum = accum.slice(headerEnd + 4);
    }
    if (contentLength > 0 && accum.length >= contentLength) {
      const json = accum.slice(0, contentLength);
      accum = accum.slice(contentLength);
      contentLength = 0;
      try {
        const resp = JSON.parse(json);
        console.log("⬅️  Response:", JSON.stringify(resp, null, 2));
      } catch {
        /* ignore */
      }
    } else {
      break;
    }
  }
});

child.stderr!.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function demo(): Promise<void> {
  // Give the MCP server time to boot and connect its observer
  await sleep(2000);

  console.log("\n🚀 Sending initialize request...\n");
  send({
    id: ++msgId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "demo-driver", version: "1.0.0" },
    },
  });
  await sleep(1500);

  // Send initialized notification
  send({ method: "notifications/initialized" });
  await sleep(500);

  console.log("\n� Calling search_projects tool...\n");
  send({
    id: ++msgId,
    method: "tools/call",
    params: {
      name: "search_projects",
      arguments: { team_id: "123456", query: "homepage" },
    },
  });
  await sleep(2000);

  console.log("\n💬 Calling get_file_comments tool...\n");
  send({
    id: ++msgId,
    method: "tools/call",
    params: {
      name: "get_file_comments",
      arguments: { file_key: "abc123xyz", as_md: true },
    },
  });
  await sleep(2000);

  console.log("\n✅ Demo complete! Check the dashboard at http://localhost:5173\n");
  console.log(
    "   (API calls will show errors without a valid FIGMA_API_TOKEN — that's expected)\n",
  );

  child.kill("SIGTERM");
  await sleep(500);
  process.exit(0);
}

demo();
