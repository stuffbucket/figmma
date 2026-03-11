#!/usr/bin/env bash
set -euo pipefail

# figmma installer — checks dependencies and installs into the current project.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/stuffbucket/figmma/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/stuffbucket/figmma/main/install.sh | bash -s -- --global
#
# What it does:
#   1. Checks for Node.js >= 18 (installs if missing)
#   2. Runs `npm install figmma` (or `npm install -g figmma`)
#   3. postinstall registers the MCP server with Claude Code, VS Code, and Codex

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

NODE_MIN_VERSION=18

info()  { echo -e "${GREEN}✔${RESET} $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $*"; }
error() { echo -e "${RED}✘${RESET} $*" >&2; }
step()  { echo -e "\n${BOLD}$*${RESET}"; }

# --- Parse flags ---
GLOBAL=false
for arg in "$@"; do
  case "$arg" in
    --global|-g) GLOBAL=true ;;
    --help|-h)
      echo "Usage: install.sh [--global]"
      echo "  --global, -g   Install globally (npm install -g)"
      echo "  (default)      Install into the current project"
      exit 0
      ;;
  esac
done

# --- Detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"

# --- Check / install Node.js ---
step "Checking Node.js..."

check_node_version() {
  if ! command -v node &>/dev/null; then
    return 1
  fi
  local ver
  ver="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$ver" -lt "$NODE_MIN_VERSION" ] 2>/dev/null; then
    return 1
  fi
  return 0
}

install_node() {
  step "Installing Node.js..."

  case "$OS" in
    Darwin)
      if command -v brew &>/dev/null; then
        info "Installing via Homebrew..."
        brew install node
      else
        warn "Homebrew not found. Installing via the official Node.js installer..."
        warn "You can also install Homebrew first: https://brew.sh"
        # Use the official install script from nodejs.org
        curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o /dev/null
        local pkg_arch="arm64"
        [ "$ARCH" = "x86_64" ] && pkg_arch="x64"
        local pkg_url="https://nodejs.org/dist/latest-v22.x/node-v22.16.0-darwin-${pkg_arch}.tar.gz"
        warn "Download Node.js from https://nodejs.org/ and re-run this script."
        exit 1
      fi
      ;;

    Linux)
      if command -v apt-get &>/dev/null; then
        info "Installing via apt..."
        sudo apt-get update -qq
        sudo apt-get install -y -qq nodejs npm
      elif command -v dnf &>/dev/null; then
        info "Installing via dnf..."
        sudo dnf install -y nodejs npm
      elif command -v pacman &>/dev/null; then
        info "Installing via pacman..."
        sudo pacman -Sy --noconfirm nodejs npm
      elif command -v apk &>/dev/null; then
        info "Installing via apk..."
        sudo apk add --no-cache nodejs npm
      else
        error "Could not detect a package manager. Install Node.js >= $NODE_MIN_VERSION manually:"
        error "  https://nodejs.org/en/download"
        exit 1
      fi
      ;;

    MINGW*|MSYS*|CYGWIN*)
      # Windows (Git Bash / MSYS2)
      if command -v winget &>/dev/null; then
        info "Installing via winget..."
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      elif command -v choco &>/dev/null; then
        info "Installing via Chocolatey..."
        choco install nodejs-lts -y
      else
        error "Install Node.js >= $NODE_MIN_VERSION from https://nodejs.org/ or via:"
        error "  winget install OpenJS.NodeJS.LTS"
        exit 1
      fi
      ;;

    *)
      error "Unsupported platform: $OS"
      error "Install Node.js >= $NODE_MIN_VERSION manually: https://nodejs.org/"
      exit 1
      ;;
  esac
}

if check_node_version; then
  info "Node.js $(node -v) found"
else
  if command -v node &>/dev/null; then
    warn "Node.js $(node -v) is too old (need >= $NODE_MIN_VERSION)"
  fi
  install_node

  # Re-check after install
  if ! check_node_version; then
    error "Node.js installation failed or version is still too old."
    error "Install Node.js >= $NODE_MIN_VERSION manually and re-run this script."
    exit 1
  fi
  info "Node.js $(node -v) installed"
fi

# Verify npm is available
if ! command -v npm &>/dev/null; then
  error "npm not found. Install Node.js with npm included: https://nodejs.org/"
  exit 1
fi
info "npm $(npm -v) found"

# --- Install figmma ---
step "Installing figmma..."

if [ "$GLOBAL" = true ]; then
  npm install -g figmma
  info "figmma installed globally"
else
  npm install figmma
  info "figmma installed"
fi

# --- Summary ---
step "Done!"
echo ""

if [ "$GLOBAL" = true ]; then
  echo "  The postinstall script registered figmma with:"
  echo "    • Claude Code     (~/.claude.json)"
  echo "    • Codex CLI       (~/.codex/mcp.json)"
  echo ""
  echo "  For VS Code / GitHub Copilot, follow the instructions printed above"
  echo "  to add the MCP entry to your VS Code settings.json."
else
  echo "  The postinstall script registered figmma with:"
  echo "    • Claude Code     (.mcp.json)"
  echo "    • VS Code / Copilot (.vscode/mcp.json)"
  echo "    • Codex CLI       (.codex/mcp.json)"
fi
echo ""
echo "  Start your agent — figmma's Figma tools are ready to use."
echo "  Run 'npx figmma' to test, or open the dashboard at http://localhost:5183"
echo ""
