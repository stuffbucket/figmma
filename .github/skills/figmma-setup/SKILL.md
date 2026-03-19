---
name: figmma-setup
description: "Install, configure, and use the figmma MCP server for the Figma API. USE FOR: setting up figmma in Claude Code, VS Code / GitHub Copilot, or Codex CLI; configuring Figma API tokens; troubleshooting MCP connection issues; understanding available tools. DO NOT USE FOR: Figma design questions, CSS/layout help, or npm publishing."
---

# figmma — Setup & Usage

MCP server that gives AI agents access to the Figma API with a real-time observability dashboard.

## Install

### One-line install (recommended)

Installs Node.js if missing, installs figmma globally, and registers with all supported agents:

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/stuffbucket/figmma/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/stuffbucket/figmma/main/install.ps1 | iex
```

### npm install

```bash
npm install -g @stuffbucket/figmma
```

The postinstall script automatically registers figmma with Claude Code, VS Code / GitHub Copilot, and Codex CLI.

## Configure by Agent

### Claude Code

**Project-level** (recommended):

```bash
npm install @stuffbucket/figmma
```

This creates `.mcp.json` in the project root automatically.

Or add manually to `.mcp.json`:

```json
{
  "mcpServers": {
    "figmma": {
      "command": "npx",
      "args": ["-y", "@stuffbucket/figmma"]
    }
  }
}
```

**User-level** (all projects):

```bash
claude mcp add --transport stdio figmma --scope user -- npx -y @stuffbucket/figmma
```

### VS Code / GitHub Copilot

**Project-level** — `.vscode/mcp.json` (created automatically by `npm install`):

```json
{
  "servers": {
    "figmma": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@stuffbucket/figmma"]
    }
  }
}
```

**User-level** — add to VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "figmma": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@stuffbucket/figmma"]
      }
    }
  }
}
```

### Codex CLI

Add to `.codex/mcp.json` (created automatically by `npm install`):

```json
{
  "mcpServers": {
    "figmma": {
      "command": "npx",
      "args": ["-y", "@stuffbucket/figmma"]
    }
  }
}
```

## Figma API Token Setup

On first run with no token configured, figmma opens a browser-based setup wizard where you enter:

1. Your [Figma Personal Access Token](https://www.figma.com/developers/api#access-tokens)
2. Your team URL (e.g. `https://www.figma.com/files/ORGID/team/TEAMID`)

Config is stored at:

- **macOS / Linux:** `~/.config/figmma/config.json`
- **Windows:** `%APPDATA%\figmma\config.json`

Environment variables override the config file when set in your MCP client's env block:

- `FIGMA_API_TOKEN` — your Figma personal access token
- `FIGMA_TEAM_ID` — your Figma team ID

Example with env vars in `.mcp.json`:

```json
{
  "mcpServers": {
    "figmma": {
      "command": "npx",
      "args": ["-y", "@stuffbucket/figmma"],
      "env": {
        "FIGMA_API_TOKEN": "figd_...",
        "FIGMA_TEAM_ID": "123456789"
      }
    }
  }
}
```

## Available Tools

| Tool                 | Description                                       |
| -------------------- | ------------------------------------------------- |
| `get_current_user`   | Show the authenticated Figma user (cached)        |
| `parse_figma_url`    | Extract file key and node ID from a Figma URL     |
| `list_team_projects` | List all projects in a team                       |
| `list_project_files` | List all files in a project                       |
| `get_file_info`      | Get file metadata (name, version, last modified)  |
| `search_projects`    | Search for files by name across all team projects |
| `get_file_comments`  | Retrieve all comments and threads on a file       |

All tools are read-only and idempotent.

## Dashboard

figmma includes a real-time observability dashboard at `http://localhost:5183` showing:

- Live MCP tool calls and Figma API requests
- Connection state and auth status
- Interactive REPL to test tools from the browser

The dashboard starts automatically when the MCP server launches.

## Troubleshooting

| Problem                    | Fix                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| "Missing Figma API token"  | Set `FIGMA_API_TOKEN` in env or run the setup wizard via the dashboard                     |
| "No team ID provided"      | Set `FIGMA_TEAM_ID` in env or complete the setup wizard                                    |
| MCP server not detected    | Verify the config file exists in the right location for your agent (see Configure section) |
| `npx` timeout on first run | Run `npx -y @stuffbucket/figmma` manually once to cache the package                        |

## Uninstall

```bash
npm uninstall -g @stuffbucket/figmma
```

The preuninstall script removes MCP server entries from `.mcp.json`, `.vscode/mcp.json`, and `.codex/mcp.json`.
