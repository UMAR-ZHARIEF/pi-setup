<#
serve.ps1
Starts, stops, or reports on a detached Next.js production server for one project directory and port.
Tool calls that launch a dev or production server in the foreground hang forever, because the server
process never exits and so the calling command never returns. This script instead launches node.exe
as a hidden detached process, records its PID, waits until the port answers, and gives clean stop and
status modes, so an agent or a human can start a server and keep working without a stuck command.
Optional -Env takes NAME=value entries and passes them to the server process. Multiple entries are
passed as ONE comma-joined value, for example -Env 'OPENROUTER_API_KEY=,FIREBASE_DATABASE_URL=';
this is how array parameters bind through pwsh -File, while repeated -Env switches are rejected and
the following tokens become stray positionals. Entries may arrive as separate array items or as one
comma-joined token, and both forms are handled. A value that contains a comma followed directly by
something that looks like NAME= is not supported, because that comma is taken as the start of the
next entry. A NAME= entry with an empty value means force this
variable present and effectively empty. This matters because Next.js loads a project's .env.local
and the real secrets there win unless the variable already exists in the process environment, so
-Env is the way to override them. Internally an empty value is stored as a single space, because
Start-Process -Environment silently drops entries whose value is an empty string, and a single space
survives while applications that trim values read it as empty, which is what overrides .env.local.
Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Action start -ProjectDir <path> -Port <n> [-Env 'NAME=value,NAME=value']
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [ValidateScript({ if ([System.IO.Path]::IsPathRooted($_)) { $true } else { throw "ProjectDir must be an absolute path, got: $_" } })]
    [string]$ProjectDir,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int]$Port,

    # NAME=value entries handed to the server process. A single space value means present but
    # effectively empty, because Start-Process -Environment drops entries with an empty string value.
    [ValidateScript({
        if (-not $_) { return $true }
        foreach ($entry in $_) {
            # One quoted token can carry several comma-joined entries through pwsh -File, so split
            # on commas that start another NAME= entry and validate each piece on its own.
            foreach ($piece in ($entry -split ',(?=[A-Za-z_][A-Za-z0-9_]*=)')) {
                if ($piece -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') {
                    throw "Env entries must look like NAME=value, got: $piece"
                }
            }
        }
        $true
    })]
    [string[]]$Env
)

$ErrorActionPreference = 'Stop'

# All bookkeeping lives outside any repository, in the temp directory.
$logDir = Join-Path $env:TEMP 'opencode'
$outLog = Join-Path $logDir "serve-$Port-out.log"
$errLog = Join-Path $logDir "serve-$Port-err.log"
$pidFile = Join-Path $logDir "serve-$Port.pid"

function Get-ListenPid {
    param([int]$LocalPort)
    $conn = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { [int]$conn.OwningProcess } else { $null }
}

if ($Action -eq 'start') {
    if (-not (Test-Path -LiteralPath $ProjectDir -PathType Container)) {
        Write-Output "FAIL project directory not found: $ProjectDir"
        exit 1
    }
    $busy = Get-ListenPid -LocalPort $Port
    if ($busy) {
        Write-Output "FAIL port $Port is already listening, owning PID $busy. Run -Action stop first if you want to restart it."
        exit 2
    }
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Output "FAIL node.exe was not found on PATH."
        exit 1
    }
    # node.exe is launched directly because Start-Process rejects npm.cmd shims as not a valid Win32 application.
    $startArgs = @{
        FilePath = $nodeCmd.Source
        ArgumentList = 'node_modules\next\dist\bin\next', 'start', '-p', "$Port"
        WorkingDirectory = $ProjectDir
        WindowStyle = 'Hidden'
        RedirectStandardOutput = $outLog
        RedirectStandardError = $errLog
        PassThru = $true
    }
    if ($Env) {
        # -Environment takes a hashtable. Entries can arrive as separate array items or as one
        # comma-joined token, so first split on commas that start another NAME= entry. Splitting
        # each piece on the first = only keeps any later = signs inside the value.
        $envMap = @{}
        foreach ($entry in $Env) {
            $expanded = $entry -split ',(?=[A-Za-z_][A-Za-z0-9_]*=)'
            foreach ($piece in $expanded) {
                if ($piece -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') {
                    throw "Env entries must look like NAME=value, got: $piece"
                }
                $name, $value = $piece.Split('=', 2)
                if ($value -eq '') {
                    # Start-Process -Environment silently drops entries whose value is an empty string.
                    # A single space survives, and applications that trim values read it as empty, which
                    # is exactly what overrides values coming from a project's .env.local file.
                    $value = ' '
                }
                $envMap[$name] = $value
            }
        }
        $startArgs['Environment'] = $envMap
    }
    $proc = Start-Process @startArgs
    Set-Content -LiteralPath $pidFile -Value $proc.Id
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if (Get-ListenPid -LocalPort $Port) { break }
        if ($proc.HasExited) { break }
        Start-Sleep -Seconds 1
    }
    $listenPid = Get-ListenPid -LocalPort $Port
    if ($listenPid) {
        Write-Output "OK port $Port is listening, PID $listenPid, out log $outLog, err log $errLog"
        exit 0
    }
    Write-Output "FAIL port $Port never started listening (started PID $($proc.Id), process exited: $($proc.HasExited)). Last 15 lines of the error log:"
    if (Test-Path -LiteralPath $errLog) {
        Get-Content -LiteralPath $errLog -Tail 15 | ForEach-Object { Write-Output "  $_" }
    } else {
        Write-Output "  (no error log was written)"
    }
    exit 1
}

if ($Action -eq 'stop') {
    $target = Get-ListenPid -LocalPort $Port
    if (-not $target) {
        # The port is free, but the saved process may still be starting up or wedged, so fall back to the PID file.
        if (Test-Path -LiteralPath $pidFile) {
            $saved = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($saved -match '^\d+$' -and (Get-Process -Id ([int]$saved) -ErrorAction SilentlyContinue)) {
                $target = [int]$saved
            }
        }
    }
    if (-not $target) {
        Write-Output "OK nothing to stop, port $Port is free and no saved process is running"
        exit 0
    }
    # /T kills the whole process tree, a plain kill would orphan child processes.
    taskkill /PID $target /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Output "FAIL taskkill exited with code $LASTEXITCODE for PID $target"
        exit 1
    }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        $gone = -not (Get-Process -Id $target -ErrorAction SilentlyContinue)
        if ($gone -and -not (Get-ListenPid -LocalPort $Port)) { break }
        Start-Sleep -Milliseconds 500
    }
    $stillRunning = [bool](Get-Process -Id $target -ErrorAction SilentlyContinue)
    $stillListening = [bool](Get-ListenPid -LocalPort $Port)
    if ($stillRunning) {
        Write-Output "FAIL PID $target is still running after taskkill (port $Port listening: $stillListening)"
        exit 1
    }
    if (Test-Path -LiteralPath $pidFile) {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    Write-Output "OK stopped PID $target, port $Port is free (listening: $stillListening)"
    exit 0
}

# status is read-only and always exits 0.
$listenPid = Get-ListenPid -LocalPort $Port
if ($listenPid) {
    $procInfo = Get-Process -Id $listenPid -ErrorAction SilentlyContinue
    $started = if ($procInfo) { $procInfo.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'unknown' }
    Write-Output "STATUS port $Port listening: yes, owning PID: $listenPid, process started: $started"
} else {
    Write-Output "STATUS port $Port listening: no"
}
Write-Output "STATUS out log: $outLog"
Write-Output "STATUS err log: $errLog"
Write-Output "STATUS pid file: $pidFile (exists: $(Test-Path -LiteralPath $pidFile))"
exit 0
