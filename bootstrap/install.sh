#!/usr/bin/env bash
# pi-setup bootstrap for Linux.
# Creates ~/.pi/agent, installs the pi coding agent and pinned packages,
# and copies template configs ONLY when the machine does not already have them.
#
# Portability note: config/mcp.json points the playwright MCP server at the
# environment variable BRAVE_PATH (via PLAYWRIGHT_MCP_EXECUTABLE_PATH) instead
# of a hard-coded browser path. Set BRAVE_PATH to your browser executable in
# your shell profile or systemd user environment.
set -euo pipefail

step() {
    echo
    echo "==> $1"
}

step "Checking node version (need >= 22.19)"
if ! command -v node >/dev/null 2>&1; then
    echo "node not found. Install node 22.19 or newer and rerun."
    exit 1
fi
node_version="$(node --version | sed 's/^v//')"
required_major=22
required_minor=19
major="$(echo "$node_version" | cut -d. -f1)"
minor="$(echo "$node_version" | cut -d. -f2)"
if [ "$major" -lt "$required_major" ] || { [ "$major" -eq "$required_major" ] && [ "$minor" -lt "$required_minor" ]; }; then
    echo "Node $node_version is too old. This setup needs node >= 22.19. Please upgrade node and rerun."
    exit 1
fi
echo "Node $node_version is OK."

step "Installing pi coding agent 0.85.1 globally (scripts ignored)"
npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@0.85.1"

step "Copying template configs into $HOME/.pi/agent (existing files are never overwritten)"
config_dir="$HOME/.pi/agent"
mkdir -p "$config_dir"
template_dir="$(cd "$(dirname "$0")/.." && pwd)/config"
for file in settings.json keybindings.json models.json mcp.json; do
    if [ -e "$config_dir/$file" ]; then
        echo "SKIP: $file already exists in $config_dir, leaving it untouched."
    else
        cp "$template_dir/$file" "$config_dir/$file"
        echo "COPIED: $file"
    fi
done

step "Persisting environment flags into ~/.bashrc (only if missing)"
bashrc="$HOME/.bashrc"
touch "$bashrc"
for pair in "NODE_USE_SYSTEM_CA=1" "PI_SKIP_VERSION_CHECK=1" "PI_BG_DISABLE_UPDATE_CHECK=1"; do
    name="${pair%%=*}"
    if grep -q "$name=" "$bashrc"; then
        echo "SKIP: $name already in ~/.bashrc"
    else
        echo "export $pair" >> "$bashrc"
        echo "ADDED: export $pair"
    fi
    export "$pair"
done

step "Installing pinned pi packages"
pi install npm:pi-mcp-adapter@2.33.0
pi install npm:pi-background-tasks@2.5.0
pi install npm:pi-subagents@0.66.0
# Pinning the repo install to a commit is optional; see the README.
pi install git:github.com/UMAR-ZHARIEF/pi-setup

step "Removing the powershell tool from the freshly copied settings.json (Linux has no powershell tool)"
# Rule 1 (invoke python only via py) applies to Windows shells; on this Linux
# path sed is simpler and avoids a python dependency entirely.
settings_target="$config_dir/settings.json"
if grep -q '"powershell",' "$settings_target"; then
    sed -i '/"powershell",/d' "$settings_target"
    echo "REMOVED: powershell entry from defaultTools"
fi
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('settings.json still parses')" "$settings_target"

echo
echo "Bootstrap finished. Remaining manual steps:"
echo "1. Set GITHUB_PERSONAL_ACCESS_TOKEN (needed by the github MCP server), e.g. add to ~/.bashrc."
echo "2. Optionally set BRAVE_PATH to your browser executable (playwright MCP)."
echo "3. Optionally install trash-cli, and serena via: uv tool install serena (or pipx install serena)."
echo "4. Source ~/.bashrc, run pi, then run /login zai once."
