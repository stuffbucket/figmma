/**
 * Cross-platform config file at the OS-idiomatic location:
 *   macOS/Linux: $XDG_CONFIG_HOME/figmma/config.json  (default ~/.config/figmma/)
 *   Windows:     %APPDATA%\figmma\config.json
 *
 * process.env always takes precedence — if FIGMA_API_TOKEN or FIGMA_TEAM_ID
 * are set in the MCP client's env block, they win over the config file.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";

const APP_NAME = "figmma";

interface ConfigData {
  figmaApiToken?: string;
  figmaTeamId?: string;
  figmaOrgId?: string;
}

function getConfigDir(): string {
  if (platform() === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, APP_NAME);
  }
  // macOS + Linux + other — XDG
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, APP_NAME);
}

const CONFIG_DIR = getConfigDir();
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function ensureDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function readFile(): ConfigData {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ConfigData;
  } catch {
    return {};
  }
}

function writeFile(data: ConfigData): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  // Lock down permissions on non-Windows (contains secrets)
  if (platform() !== "win32") {
    try {
      chmodSync(CONFIG_PATH, 0o600);
    } catch {
      // Best effort — may fail in some container environments
    }
  }
}

// ---- Public API ----

/** Get the Figma API token. process.env wins, then config file. */
export function getToken(): string | undefined {
  return process.env.FIGMA_API_TOKEN || process.env.FIGMA_TOKEN || readFile().figmaApiToken || undefined;
}

/** Get the Figma team ID. process.env wins, then config file. */
export function getTeamId(): string | undefined {
  return process.env.FIGMA_TEAM_ID || readFile().figmaTeamId || undefined;
}

/** Get the Figma org/workspace ID. Config file only (no env var convention). */
export function getOrgId(): string | undefined {
  return readFile().figmaOrgId || undefined;
}

/** Save the API token to the config file. */
export function setToken(token: string): void {
  const data = readFile();
  data.figmaApiToken = token;
  writeFile(data);
}

/** Save the team ID to the config file. */
export function setTeamId(teamId: string): void {
  const data = readFile();
  data.figmaTeamId = teamId;
  writeFile(data);
}

/** Save the org/workspace ID to the config file. */
export function setOrgId(orgId: string): void {
  const data = readFile();
  data.figmaOrgId = orgId;
  writeFile(data);
}

/** Get all config values (for status display). */
export function getAll(): { token: string | undefined; teamId: string | undefined; orgId: string | undefined } {
  return { token: getToken(), teamId: getTeamId(), orgId: getOrgId() };
}

/** Path to the config file (for user-facing messages). */
export const configPath = CONFIG_PATH;

/** Dashboard port — shared across MCP server, logger, and dashboard. */
export const DASHBOARD_PORT = 5183;
