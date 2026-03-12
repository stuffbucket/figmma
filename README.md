# figmma

MCP server for the Figma API with a real-time observability dashboard.

## Install

**macOS / Linux** (checks for Node.js, installs if missing, registers with all agents):

```bash
curl -fsSL https://raw.githubusercontent.com/stuffbucket/figmma/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/stuffbucket/figmma/main/install.ps1 | iex
```

**Or via npm** (requires Node.js >= 18):

```bash
npm install -g @stuffbucket/figmma
```

The postinstall script automatically registers figmma with Claude Code, VS Code / GitHub Copilot, and Codex CLI.

## Configure

### Claude Code

**Project-level** (recommended — runs `postinstall` automatically):

```bash
npm install @stuffbucket/figmma
```

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

**User-level** (available in all projects):

```bash
claude mcp add --transport stdio figmma --scope user -- npx -y @stuffbucket/figmma
```

### VS Code / GitHub Copilot

**Project-level** — add to `.vscode/mcp.json` (created automatically by `npm install`):

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

**User-level** — add to VS Code settings (`settings.json`):

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

## Setup

On first run with no Figma API token configured, figmma opens a setup wizard in your browser where you enter your [Figma Personal Access Token](https://www.figma.com/developers/api#access-tokens) and team URL.

Configuration is stored at:

- **macOS / Linux:** `~/.config/figmma/config.json`
- **Windows:** `%APPDATA%\figmma\config.json`

Environment variables `FIGMA_API_TOKEN` and `FIGMA_TEAM_ID` override the config file when set in your MCP client's env block.

## Tools

| Tool                 | Description                                       |
| -------------------- | ------------------------------------------------- |
| `get_current_user`   | Show the authenticated Figma user (cached)        |
| `parse_figma_url`    | Extract file key and node ID from a Figma URL     |
| `list_team_projects` | List all projects in a team                       |
| `list_project_files` | List all files in a project                       |
| `get_file_info`      | Get file metadata (name, version, last modified)  |
| `search_projects`    | Search for files by name across all team projects |
| `get_file_comments`  | Retrieve all comments and threads on a file       |

## Dashboard

figmma includes a real-time observability dashboard at `http://localhost:5183` that shows:

- Live MCP tool calls and Figma API requests
- Connection state and auth status
- An interactive REPL to test tools from the browser

The dashboard starts automatically when the MCP server launches. Run it standalone with:

```bash
npx @stuffbucket/figmma-dashboard   # or: npm run dev (in the source repo)
```

## Development

```bash
git clone https://github.com/stuffbucket/figmma.git
cd figmma
npm ci
npm run dev          # Dashboard with Vite HMR
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build
npm test             # E2E smoke test
make pack            # Build + npm pack → figmma-1.0.0.tgz
```

## Uninstall

```bash
npm uninstall -g @stuffbucket/figmma
```

This removes the MCP server entries from `.mcp.json`, `.vscode/mcp.json`, and `.codex/mcp.json`.
