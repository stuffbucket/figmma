#!/usr/bin/env node

// Runs after `npm install figmma` in a consumer project.
// Adds the figmma MCP server entry to .mcp.json in the project root
// so Claude Code picks it up automatically.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.env.INIT_CWD;
if (!projectRoot) process.exit(0);

const mcpPath = join(projectRoot, ".mcp.json");

const entry = {
  command: "npx",
  args: ["figmma"],
};

let config;
try {
  config = JSON.parse(readFileSync(mcpPath, "utf-8"));
} catch {
  config = {};
}

config.mcpServers = config.mcpServers || {};
config.mcpServers.figmma = entry;

writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
console.log("figmma: registered MCP server in .mcp.json");
