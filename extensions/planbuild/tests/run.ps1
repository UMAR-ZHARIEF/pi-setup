$ErrorActionPreference = "Stop"

$testsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $testsDir

if (-not (Test-Path -LiteralPath "..\posture.ts") -or -not (Test-Path -LiteralPath "..\reminders.ts") -or -not (Test-Path -LiteralPath "..\modelifecycle.ts") -or -not (Test-Path -LiteralPath "..\timeout.ts")) {
    Write-Host "SKIP: ../posture.ts or ../reminders.ts or ../modelifecycle.ts or ../timeout.ts is not present yet"
    exit 2
}

$nodeOut = [string](& node --version 2>$null)
if ($LASTEXITCODE -ne 0 -or $nodeOut -eq "") {
    Write-Host "ERROR: node is not available"
    exit 1
}
Write-Host "node version: $nodeOut"

$parts = $nodeOut.Trim().TrimStart("v").Split(".")
$major = [int]$parts[0]
$minor = [int]$parts[1]
$results = [ordered]@{}

if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 6)) {
    Write-Host "mode: node --test --experimental-strip-types"
    $flags = @("--test", "--experimental-strip-types")
    if ($major -eq 22) { $flags += "--experimental-detect-module" }
    & node @flags .\posture.test.ts
    $results["posture.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\reminders.test.ts
    $results["reminders.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\modelifecycle.test.ts
    $results["modelifecycle.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\timeout.test.ts
    $results["timeout.test.ts"] = ($LASTEXITCODE -eq 0)
}
else {
    Write-Host "mode: npx esbuild compile, then node --test"
    $outDir = Join-Path $env:TEMP "planbuild-tests-esbuild"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $outPosture = Join-Path $outDir "posture.cjs"
    $outReminders = Join-Path $outDir "reminders.cjs"
    $outModelifecycle = Join-Path $outDir "modelifecycle.cjs"
    $outTimeout = Join-Path $outDir "timeout.cjs"
    $outPostureTest = Join-Path $outDir "posture.test.cjs"
    $outRemindersTest = Join-Path $outDir "reminders.test.cjs"
    $outModelifecycleTest = Join-Path $outDir "modelifecycle.test.cjs"
    $outTimeoutTest = Join-Path $outDir "timeout.test.cjs"
    & npx --yes esbuild "..\posture.ts" --bundle --platform=node --format=cjs --outfile="$outPosture"
    & npx --yes esbuild "..\reminders.ts" --bundle --platform=node --format=cjs --outfile="$outReminders"
    & npx --yes esbuild "..\modelifecycle.ts" --bundle --platform=node --format=cjs --outfile="$outModelifecycle"
    & npx --yes esbuild "..\timeout.ts" --bundle --platform=node --format=cjs --outfile="$outTimeout"
    & npx --yes esbuild ".\posture.test.ts" --bundle --platform=node --format=cjs --outfile="$outPostureTest"
    & npx --yes esbuild ".\reminders.test.ts" --bundle --platform=node --format=cjs --outfile="$outRemindersTest"
    & npx --yes esbuild ".\modelifecycle.test.ts" --bundle --platform=node --format=cjs --outfile="$outModelifecycleTest"
    & npx --yes esbuild ".\timeout.test.ts" --bundle --platform=node --format=cjs --outfile="$outTimeoutTest"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: esbuild compilation failed"
        exit 1
    }
    & node --test "$outPostureTest"
    $results["posture.test.ts"] = ($LASTEXITCODE -eq 0)
    & node --test "$outRemindersTest"
    $results["reminders.test.ts"] = ($LASTEXITCODE -eq 0)
    & node --test "$outModelifecycleTest"
    $results["modelifecycle.test.ts"] = ($LASTEXITCODE -eq 0)
    & node --test "$outTimeoutTest"
    $results["timeout.test.ts"] = ($LASTEXITCODE -eq 0)
}

Write-Host ""
Write-Host "=== summary ==="
foreach ($key in $results.Keys) {
    if ($results[$key]) { Write-Host "PASS $key" } else { Write-Host "FAIL $key" }
}
$failed = @($results.Values) -contains $false
if ($failed) { exit 1 }
exit 0
