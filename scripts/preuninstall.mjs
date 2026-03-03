#!/usr/bin/env node

// Runs before `npm uninstall figmma` in a consumer project.
// Removes the figmma MCP server entry from .mcp.json.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.env.INIT_CWD;
if (!projectRoot) process.exit(0);

const mcpPath = join(projectRoot, ".mcp.json");

let config;
try {
  config = JSON.parse(readFileSync(mcpPath, "utf-8"));
} catch {
  process.exit(0);
}

if (config.mcpServers) {
  delete config.mcpServers.figmma;

  // Clean up empty file
  if (Object.keys(config.mcpServers).length === 0) {
    delete config.mcpServers;
  }
}

if (Object.keys(config).length === 0) {
  unlinkSync(mcpPath);
  console.log("figmma: removed .mcp.json (was empty)");
} else {
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
  console.log("figmma: removed MCP server entry from .mcp.json");
}
