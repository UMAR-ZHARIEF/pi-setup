$ErrorActionPreference = "Stop"

$testsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $testsDir

if (-not (Test-Path -LiteralPath "..\guard.ts")) {
    Write-Host "SKIP: ../guard.ts is not present yet"
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
    & node @flags .\sessionguard.test.ts
    $results["sessionguard.test.ts"] = ($LASTEXITCODE -eq 0)
}
else {
    Write-Host "mode: npx esbuild compile, then node --test"
    $outDir = Join-Path $env:TEMP "sessionguard-tests-esbuild"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $outGuard = Join-Path $outDir "guard.cjs"
    $outGuardTest = Join-Path $outDir "sessionguard.test.cjs"
    & npx --yes esbuild "..\guard.ts" --bundle --platform=node --format=cjs --outfile="$outGuard"
    & npx --yes esbuild ".\sessionguard.test.ts" --bundle --platform=node --format=cjs --outfile="$outGuardTest"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: esbuild compilation failed"
        exit 1
    }
    & node --test "$outGuardTest"
    $results["sessionguard.test.ts"] = ($LASTEXITCODE -eq 0)
}

Write-Host ""
Write-Host "=== summary ==="
foreach ($key in $results.Keys) {
    if ($results[$key]) { Write-Host "PASS $key" } else { Write-Host "FAIL $key" }
}
$failed = @($results.Values) -contains $false
if ($failed) { exit 1 }
exit 0
