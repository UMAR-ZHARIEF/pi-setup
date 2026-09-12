param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Paths,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$LogFile = "C:\Users\Guess\.config\opencode\hooks\safe-delete.log"
$MaxItemsWithoutForce = 1000
$MaxBytesWithoutForce = 500MB

function Write-SafeLog([string]$Message) {
    try {
        Add-Content -LiteralPath $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
    } catch { }
}

function Get-NormalizedPath([string]$Path) {
    try {
        return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\').ToLowerInvariant()
    } catch {
        return $Path.TrimEnd('\').ToLowerInvariant()
    }
}

$ProtectedRoots = @(
    'C:\',
    'C:\Windows',
    'C:\Program Files',
    'C:\Program Files (x86)',
    'C:\ProgramData',
    "$env:USERPROFILE",
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\.claude",
    "$env:USERPROFILE\.config\opencode",
    "$env:USERPROFILE\.config\opencode\hooks",
    "$env:LOCALAPPDATA\Programs\Python",
    "$env:LOCALAPPDATA\Programs\Python\Python311",
    "$env:LOCALAPPDATA\Programs\Python\Python311\Lib",
    "$env:LOCALAPPDATA\Programs\Python\Python311\Lib\site-packages",
    "$env:LOCALAPPDATA\ms-playwright",
    'C:\Users\Guess\Documents\Projects\TDC',
    'C:\Users\Guess\Documents\Projects\TDC\notes',
    'C:\Users\Guess\Documents\Projects\TDC\Briefing',
    'C:\Users\Guess\Documents\Projects\TDC\ebooks'
) | ForEach-Object { Get-NormalizedPath $_ }

if (-not $Paths -or $Paths.Count -eq 0) {
    [Console]::Error.WriteLine("recycle: no paths given. Usage: recycle.ps1 <path> [<path>...] [-Force] [-DryRun]")
    exit 1
}

Add-Type -AssemblyName Microsoft.VisualBasic

$recycled = @()
$refused = @()
$missing = @()
$failed = @()

foreach ($rawPath in $Paths) {
    if ($rawPath -match '[\*\?\[]') {
        $items = @(Get-Item -Path $rawPath -Force -ErrorAction SilentlyContinue)
    } else {
        $items = @(Get-Item -LiteralPath $rawPath -Force -ErrorAction SilentlyContinue)
    }

    if ($items.Count -eq 0) {
        $missing += $rawPath
        Write-SafeLog ("MISSING (nothing matched): {0}" -f $rawPath)
        continue
    }

    foreach ($item in $items) {
        $fullPath = $item.FullName
        $normalizedPath = Get-NormalizedPath $fullPath

        if (($ProtectedRoots -contains $normalizedPath) -and -not $Force) {
            $refused += $fullPath
            Write-SafeLog ("REFUSED (protected root, -Force required): {0}" -f $fullPath)
            [Console]::Error.WriteLine("recycle: REFUSED protected path. Add -Force if intended; it will still go to the Recycle Bin: $fullPath")
            continue
        }

        if ($item.PSIsContainer -and -not $Force) {
            $count = 0
            $bytes = 0
            $tooBig = $false
            foreach ($child in (Get-ChildItem -LiteralPath $fullPath -Recurse -Force -ErrorAction SilentlyContinue)) {
                $count++
                if (-not $child.PSIsContainer) { $bytes += $child.Length }
                if ($count -gt $MaxItemsWithoutForce -or $bytes -gt $MaxBytesWithoutForce) {
                    $tooBig = $true
                    break
                }
            }
            if ($tooBig) {
                $refused += $fullPath
                Write-SafeLog ("REFUSED (over size/count threshold, -Force required): {0}" -f $fullPath)
                [Console]::Error.WriteLine("recycle: REFUSED large target. Add -Force if intended; it will still go to the Recycle Bin: $fullPath")
                continue
            }
        }

        if ($DryRun) {
            $recycled += $fullPath
            Write-SafeLog ("DRYRUN (would recycle): {0}" -f $fullPath)
            Write-Output "DRYRUN would recycle: $fullPath"
            continue
        }

        try {
            if ($item.PSIsContainer) {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
                    $fullPath,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
            } else {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                    $fullPath,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
            }
            $recycled += $fullPath
            Write-SafeLog ("RECYCLED: {0}" -f $fullPath)
            Write-Output "recycled -> Recycle Bin: $fullPath"
        } catch {
            $failed += $fullPath
            Write-SafeLog ("ERROR recycling {0}: {1}" -f $fullPath, $_.Exception.Message)
            [Console]::Error.WriteLine("recycle: FAILED on ${fullPath}: $($_.Exception.Message)")
        }
    }
}

$dryRunLabel = if ($DryRun) { " (DRYRUN)" } else { "" }
$summary = "recycle summary: {0} recycled{1}, {2} refused, {3} missing, {4} failed" -f $recycled.Count, $dryRunLabel, $refused.Count, $missing.Count, $failed.Count
Write-Output $summary
Write-SafeLog $summary

if (($refused.Count + $missing.Count + $failed.Count) -gt 0) { exit 1 }
exit 0
