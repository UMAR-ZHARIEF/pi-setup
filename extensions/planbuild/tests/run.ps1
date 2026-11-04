$ErrorActionPreference = "Stop"

$testsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $testsDir

if (-not (Test-Path -LiteralPath "..\engine.ts") -or -not (Test-Path -LiteralPath "..\shellgate.ts") -or -not (Test-Path -LiteralPath "..\classify.ts")) {
    Write-Host "SKIP: ../engine.ts or ../shellgate.ts or ../classify.ts is not present yet"
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
    & node @flags .\engine.test.ts
    $results["engine.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\shellgate.test.ts
    $results["shellgate.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\modelifecycle.test.ts
    $results["modelifecycle.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\classify.test.ts
    $results["classify.test.ts"] = ($LASTEXITCODE -eq 0)
    & node @flags .\timeout.test.ts
    $results["timeout.test.ts"] = ($LASTEXITCODE -eq 0)
}
else {
    Write-Host "mode: npx esbuild compile, then node --test"
    $outDir = Join-Path $env:TEMP "planbuild-tests-esbuild"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $outEngine = Join-Path $outDir "engine.cjs"
    $outShellgate = Join-Path $outDir "shellgate.cjs"
    $outModelifecycle = Join-Path $outDir "modelifecycle.cjs"
    $outClassify = Join-Path $outDir "classify.cjs"
    $outEngineTest = Join-Path $outDir "engine.test.cjs"
    $outShellgateTest = Join-Path $outDir "shellgate.test.cjs"
    $outModelifecycleTest = Join-Path $outDir "modelifecycle.test.cjs"
    $outClassifyTest = Join-Path $outDir "classify.test.cjs"
    $outTimeout = Join-Path $outDir "timeout.cjs"
    $outTimeoutTest = Join-Path $outDir "timeout.test.cjs"
    & npx --yes esbuild "..\engine.ts" --bundle --platform=node --format=cjs --outfile="$outEngine"
    & npx --yes esbuild "..\shellgate.ts" --bundle --platform=node --format=cjs --outfile="$outShellgate"
    & npx --yes esbuild "..\modelifecycle.ts" --bundle --platform=node --format=cjs --outfile="$outModelifecycle"
    & npx --yes esbuild "..\classify.ts" --bundle --platform=node --format=cjs --outfile="$outClassify"
    & npx --yes esbuild "..\timeout.ts" --bundle --platform=node --format=cjs --outfile="$outTimeout"
    & npx --yes esbuild ".\engine.test.ts" --bundle --platform=node --format=cjs --outfile="$outEngineTest"
    & npx --yes esbuild ".\shellgate.test.ts" --bundle --platform=node --format=cjs --outfile="$outShellgateTest"
    & npx --yes esbuild ".\modelifecycle.test.ts" --bundle --platform=node --format=cjs --outfile="$outModelifecycleTest"
    & npx --yes esbuild ".\classify.test.ts" --bundle --platform=node --format=cjs --outfile="$outClassifyTest"
    & npx --yes esbuild ".\timeout.test.ts" --bundle --platform=node --format=cjs --outfile="$outTimeoutTest"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: esbuild compilation failed"
        exit 1
    }
    & node --test "$outEngineTest"
    $results["engine.test.ts"] = ($LASTEXITCODE -eq 0)
    & node --test "$outShellgateTest"
    $results["shellgate.test.ts"] = ($LASTEXITCODE -eq 0)
    & node --test "$outModelifecycleTest"
    $results["modelifecycle.test.ts"] = ($LASTEXITCODE -eq 0)
    & node --test "$outClassifyTest"
    $results["classify.test.ts"] = ($LASTEXITCODE -eq 0)
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
