#!/usr/bin/env node

// Runs before `npm uninstall figmma`.
// Mirrors postinstall scope detection:
//   npm uninstall figmma      → removes from project-level configs
//   npm uninstall -g figmma   → removes from user-level configs

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const isGlobal = process.env.npm_config_global === "true";
const projectRoot = process.env.INIT_CWD;

if (!isGlobal && !projectRoot) process.exit(0);

// --- Helpers ---

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function removeEntry(filePath, serverKey, label) {
  const config = readJson(filePath);
  if (!config || !config[serverKey] || !config[serverKey].figmma) return;

  delete config[serverKey].figmma;

  if (Object.keys(config[serverKey]).length === 0) {
    delete config[serverKey];
  }

  if (Object.keys(config).length === 0) {
    unlinkSync(filePath);
    console.log(`figmma: removed ${label} (was empty)`);
  } else {
    writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
    console.log(`figmma: removed MCP entry from ${label}`);
  }
}

if (isGlobal) {
  // =====================================================================
  // GLOBAL UNINSTALL → user-level agent configs
  // =====================================================================

  const home = homedir();

  // Claude Code: ~/.claude.json
  removeEntry(join(home, ".claude.json"), "mcpServers", "~/.claude.json");

  // Codex CLI: ~/.codex/mcp.json
  removeEntry(join(home, ".codex", "mcp.json"), "mcpServers", "~/.codex/mcp.json");

  // VS Code: try to remove from settings.json if parseable
  const plat = platform();
  const settingsPaths = [];
  if (plat === "darwin") {
    const base = join(home, "Library", "Application Support");
    settingsPaths.push(join(base, "Code", "User", "settings.json"));
    settingsPaths.push(join(base, "Code - Insiders", "User", "settings.json"));
  } else if (plat === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    settingsPaths.push(join(appData, "Code", "User", "settings.json"));
    settingsPaths.push(join(appData, "Code - Insiders", "User", "settings.json"));
  } else {
    settingsPaths.push(join(home, ".config", "Code", "User", "settings.json"));
    settingsPaths.push(join(home, ".config", "Code - Insiders", "User", "settings.json"));
  }

  let removedVscode = false;
  for (const settingsPath of settingsPaths) {
    if (!existsSync(settingsPath)) continue;
    const settings = readJson(settingsPath);
    if (!settings || !settings.mcp?.servers?.figmma) continue;

    delete settings.mcp.servers.figmma;
    if (Object.keys(settings.mcp.servers).length === 0) delete settings.mcp.servers;
    if (settings.mcp && Object.keys(settings.mcp).length === 0) delete settings.mcp;

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(`figmma: removed MCP entry from ${settingsPath}`);
    removedVscode = true;
  }

  if (!removedVscode) {
    console.log("figmma: If you added figmma to VS Code user settings, remove it manually.");
  }

} else {
  // =====================================================================
  // PROJECT UNINSTALL → project-level agent configs
  // =====================================================================

  // 1. Claude Code: .mcp.json
  removeEntry(join(projectRoot, ".mcp.json"), "mcpServers", ".mcp.json");

  // 2. VS Code / Copilot: .vscode/mcp.json
  removeEntry(join(projectRoot, ".vscode", "mcp.json"), "servers", ".vscode/mcp.json");

  // 3. Codex CLI: .codex/mcp.json
  removeEntry(join(projectRoot, ".codex", "mcp.json"), "mcpServers", ".codex/mcp.json");
}
