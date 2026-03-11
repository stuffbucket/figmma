#!/usr/bin/env node

// Runs after `npm install figmma`.
//
// Scope detection:
//   npm install figmma        → project-level configs (.mcp.json, .vscode/mcp.json, .codex/mcp.json)
//   npm install -g figmma     → user-level configs (~/.claude.json, ~/.codex/mcp.json)
//
// Idempotent: skips files that already have a figmma entry (safe for upgrades).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";

const isGlobal = process.env.npm_config_global === "true";
const projectRoot = process.env.INIT_CWD;

// Project-scope needs INIT_CWD; global can proceed without it.
if (!isGlobal && !projectRoot) process.exit(0);

const entry = {
  command: "npx",
  args: ["-y", "figmma"],
};

// --- Helpers ---

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

if (isGlobal) {
  // =====================================================================
  // GLOBAL INSTALL → user-level agent configs
  // =====================================================================

  const home = homedir();

  // --- Claude Code: ~/.claude.json → mcpServers ---
  const claudePath = join(home, ".claude.json");
  const claude = readJson(claudePath) || {};
  claude.mcpServers = claude.mcpServers || {};
  if (!claude.mcpServers.figmma) {
    claude.mcpServers.figmma = { ...entry, env: {} };
    writeJson(claudePath, claude);
    console.log("figmma: registered in ~/.claude.json (Claude Code, user-level)");
  }

  // --- Codex CLI: ~/.codex/mcp.json → mcpServers ---
  const codexPath = join(home, ".codex", "mcp.json");
  const codex = readJson(codexPath) || {};
  codex.mcpServers = codex.mcpServers || {};
  if (!codex.mcpServers.figmma) {
    codex.mcpServers.figmma = entry;
    writeJson(codexPath, codex);
    console.log("figmma: registered in ~/.codex/mcp.json (Codex CLI, user-level)");
  }

  // --- VS Code / GitHub Copilot: user settings.json ---
  // settings.json is JSONC (may contain comments). Try JSON.parse; if that
  // works the file round-trips cleanly. If it fails, print a manual snippet.
  const vscodeEntry = { type: "stdio", ...entry };
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

  let wroteVscode = false;
  for (const settingsPath of settingsPaths) {
    const settings = readJson(settingsPath);
    if (settings === null && !existsSync(settingsPath)) continue; // file doesn't exist
    if (settings === null) continue; // exists but has JSONC features — skip

    settings.mcp = settings.mcp || {};
    settings.mcp.servers = settings.mcp.servers || {};
    if (!settings.mcp.servers.figmma) {
      settings.mcp.servers.figmma = vscodeEntry;
      writeJson(settingsPath, settings);
      console.log(`figmma: registered in ${settingsPath} (VS Code / Copilot, user-level)`);
    }
    wroteVscode = true;
  }

  if (!wroteVscode) {
    console.log("");
    console.log("figmma: To register with VS Code / GitHub Copilot at user scope,");
    console.log("figmma: add this to your settings.json (mcp.servers):");
    console.log("");
    console.log(JSON.stringify({ figmma: vscodeEntry }, null, 4).replace(/^/gm, "    "));
    console.log("");
  }
} else {
  // =====================================================================
  // PROJECT INSTALL → project-level agent configs
  // =====================================================================

  // --- 1. Claude Code: .mcp.json ---
  const claudePath = join(projectRoot, ".mcp.json");
  const claude = readJson(claudePath) || {};
  claude.mcpServers = claude.mcpServers || {};
  if (!claude.mcpServers.figmma) {
    claude.mcpServers.figmma = entry;
    writeJson(claudePath, claude);
    console.log("figmma: registered in .mcp.json (Claude Code)");
  }

  // --- 2. VS Code / GitHub Copilot: .vscode/mcp.json ---
  const vscodePath = join(projectRoot, ".vscode", "mcp.json");
  const vscode = readJson(vscodePath) || {};
  vscode.servers = vscode.servers || {};
  if (!vscode.servers.figmma) {
    vscode.servers.figmma = { type: "stdio", ...entry };
    writeJson(vscodePath, vscode);
    console.log("figmma: registered in .vscode/mcp.json (VS Code / Copilot)");
  }

  // --- 3. Codex CLI: .codex/mcp.json ---
  const codexPath = join(projectRoot, ".codex", "mcp.json");
  const codex = readJson(codexPath) || {};
  codex.mcpServers = codex.mcpServers || {};
  if (!codex.mcpServers.figmma) {
    codex.mcpServers.figmma = entry;
    writeJson(codexPath, codex);
    console.log("figmma: registered in .codex/mcp.json (Codex CLI)");
  }
}
