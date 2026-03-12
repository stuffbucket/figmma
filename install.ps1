#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# figmma installer for Windows
#
# Usage:
#   irm https://stuffbucket.github.io/figmma/install.ps1 | iex
#
# What it does:
#   1. Checks for Node.js >= 18 (installs via winget/choco if missing)
#   2. Runs `npm install -g @stuffbucket/figmma`
#   3. postinstall registers the MCP server with Claude Code, VS Code, and Codex

$NODE_MIN_VERSION = 18

function Write-Step($msg) { Write-Host "`n$msg" -ForegroundColor White -NoNewline; Write-Host "" }
function Write-Ok($msg)   { Write-Host "  ✔ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ✘ $msg" -ForegroundColor Red }

# --- Check Node.js ---
Write-Step "Checking Node.js..."

$nodeOk = $false
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCmd) {
    $rawVer = & node -v 2>$null
    $major = [int]($rawVer -replace '^v','').Split('.')[0]
    if ($major -ge $NODE_MIN_VERSION) {
        Write-Ok "Node.js $rawVer found"
        $nodeOk = $true
    } else {
        Write-Warn "Node.js $rawVer is too old (need >= $NODE_MIN_VERSION)"
    }
}

if (-not $nodeOk) {
    Write-Step "Installing Node.js..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $choco  = Get-Command choco  -ErrorAction SilentlyContinue

    if ($winget) {
        Write-Ok "Installing via winget..."
        & winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } elseif ($choco) {
        Write-Ok "Installing via Chocolatey..."
        & choco install nodejs-lts -y
    } else {
        Write-Err "No package manager found."
        Write-Err "Install Node.js >= $NODE_MIN_VERSION from https://nodejs.org/"
        Write-Err "  or install winget / Chocolatey first."
        exit 1
    }

    # Refresh PATH so we can find the newly installed node
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Err "Node.js installation succeeded but 'node' is not in PATH."
        Write-Err "Close and reopen PowerShell, then re-run this script."
        exit 1
    }

    $rawVer = & node -v 2>$null
    $major = [int]($rawVer -replace '^v','').Split('.')[0]
    if ($major -lt $NODE_MIN_VERSION) {
        Write-Err "Installed Node.js $rawVer is still too old (need >= $NODE_MIN_VERSION)."
        exit 1
    }
    Write-Ok "Node.js $rawVer installed"
}

# Verify npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Err "npm not found. Install Node.js with npm included: https://nodejs.org/"
    exit 1
}
Write-Ok "npm $(& npm -v) found"

# --- Install figmma ---
Write-Step "Installing @stuffbucket/figmma..."
& npm install -g @stuffbucket/figmma
if ($LASTEXITCODE -ne 0) {
    Write-Err "npm install failed."
    exit 1
}
Write-Ok "figmma installed globally"

# --- Summary ---
Write-Step "Done!"
Write-Host ""
Write-Host "  The postinstall script registered figmma with:"
Write-Host "    • Claude Code     (~/.claude.json)"
Write-Host "    • Codex CLI       (~/.codex/mcp.json)"
Write-Host ""
Write-Host "  For VS Code / GitHub Copilot, follow the instructions printed above"
Write-Host "  to add the MCP entry to your VS Code settings.json."
Write-Host ""
Write-Host "  Start your agent — figmma's Figma tools are ready to use."
Write-Host "  Run 'npx @stuffbucket/figmma' to test, or open the dashboard at http://localhost:5183"
Write-Host ""
