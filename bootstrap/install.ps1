# pi-setup bootstrap for Windows.
# Creates ~/.pi/agent, installs the pi coding agent and pinned packages,
# and copies template configs ONLY when the machine does not already have them.
#
# Portability note: config/mcp.json points the playwright MCP server at the
# environment variable BRAVE_PATH (via PLAYWRIGHT_MCP_EXECUTABLE_PATH) instead
# of a hard-coded browser path. Set BRAVE_PATH to your browser executable,
# for example:
#   setx BRAVE_PATH "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
#
# Optional manual step after install: set PI_RECYCLE_HELPER to a helper
# executable so deletes go to the recycle bin instead of being removed.

$ErrorActionPreference = "Stop"

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message"
}

Step "Checking node version (need >= 22.19)"
$nodeOutput = & node --version
$nodeVersion = $nodeOutput.TrimStart("v")
try {
    $actual = [version]$nodeVersion
} catch {
    Write-Host "Could not parse node version '$nodeOutput'. Install node 22.19 or newer."
    exit 1
}
$required = [version]"22.19.0"
if ($actual -lt $required) {
    Write-Host "Node $nodeVersion is too old. This setup needs node >= 22.19. Please upgrade node and rerun."
    exit 1
}
Write-Host "Node $nodeVersion is OK."

Step "Installing pi coding agent 0.85.1 globally (scripts ignored)"
npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@0.85.1"

Step "Copying template configs into $HOME\.pi\agent (existing files are never overwritten)"
$configDir = Join-Path $HOME ".pi\agent"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$templateDir = Join-Path $PSScriptRoot "..\config"
$files = @("settings.json", "keybindings.json", "models.json", "mcp.json")
foreach ($file in $files) {
    $source = Join-Path $templateDir $file
    $target = Join-Path $configDir $file
    if (Test-Path -LiteralPath $target) {
        Write-Host "SKIP: $file already exists in $configDir, leaving it untouched."
    } else {
        Copy-Item -LiteralPath $source -Destination $target
        Write-Host "COPIED: $file"
    }
}

Step "Setting machine environment flags"
setx NODE_USE_SYSTEM_CA 1
setx PI_SKIP_VERSION_CHECK 1
setx PI_BG_DISABLE_UPDATE_CHECK 1

Step "Installing pinned pi packages"
pi install npm:pi-mcp-adapter@2.33.0
pi install npm:pi-background-tasks@2.5.0
pi install npm:pi-subagents@0.66.0
# Pinning the repo install to a commit is optional; see the README.
pi install git:github.com/UMAR-ZHARIEF/pi-setup

Write-Host ""
Write-Host "Bootstrap finished. Remaining manual steps:"
Write-Host "1. Set GITHUB_PERSONAL_ACCESS_TOKEN (needed by the github MCP server):"
Write-Host "   setx GITHUB_PERSONAL_ACCESS_TOKEN <your-token>"
Write-Host "2. Optionally set BRAVE_PATH to your browser executable (playwright MCP)."
Write-Host "3. Optionally set PI_RECYCLE_HELPER for recycle bin deletes."
Write-Host "4. Start a NEW terminal, run pi, then run /login zai once."
