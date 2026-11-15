# Git Bash standalone setup: one-shot installer (run in PowerShell)
# Requires: Git for Windows installed at C:\Program Files\Git
# Run as: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$gitDir = "C:\Program Files\Git"
$dest = "$env:LOCALAPPDATA\Programs\GitBashDiscord"

# 1. minttyrc
Copy-Item "$PSScriptRoot\minttyrc" "$env:USERPROFILE\.minttyrc" -Force
Write-Host "[OK] minttyrc -> ~/.minttyrc"

# 2. bashrc snippet
$bashrcLine = "PROMPT_COMMAND='printf `"\033]0;Git Bash\007\033[?7711h`"'"
if (-not (Select-String -Path "$env:USERPROFILE\.bashrc" -Pattern "Git Bash" -Quiet -ErrorAction SilentlyContinue)) {
    Add-Content "$env:USERPROFILE\.bashrc" "`n# Pin the terminal window title + mintty prompt markers"
    Add-Content "$env:USERPROFILE\.bashrc" $bashrcLine
    Write-Host "[OK] bashrc snippet appended"
} else { Write-Host "[SKIP] bashrc already has title pin" }

# 3. pi keybindings (merge, do not overwrite existing)
$piKb = "$env:USERPROFILE\.pi\agent\keybindings.json"
$newKb = Get-Content "$PSScriptRoot\pi-keybindings.json" -Raw | ConvertFrom-Json
if (Test-Path $piKb) {
    $existing = Get-Content $piKb -Raw | ConvertFrom-Json
    foreach ($prop in $newKb.PSObject.Properties) {
        if (-not $existing.PSObject.Properties[$prop.Name]) {
            $existing | Add-Member -MemberType NoteProperty -Name $prop.Name -Value $prop.Value
        }
    }
    $existing | ConvertTo-Json -Depth 5 | Set-Content $piKb -Encoding UTF8
} else {
    $newKb | ConvertTo-Json -Depth 5 | Set-Content $piKb -Encoding UTF8
}
Write-Host "[OK] pi keybindings merged"

# 4. Build the wrapper
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item "$PSScriptRoot\wrapper.cs" "$dest\wrapper.cs" -Force
Copy-Item "$PSScriptRoot\rpc.json" "$dest\rpc.json" -Force
$csc = (Get-ChildItem "C:\Windows\Microsoft.NET\Framework64\v4*\csc.exe" | Select-Object -Last 1).FullName
& $csc /nologo /target:winexe /out:"$dest\Git Bash.exe" /r:System.Windows.Forms.dll "$dest\wrapper.cs"
if ($LASTEXITCODE -ne 0) { throw "wrapper compile failed" }
Write-Host "[OK] wrapper built -> $dest\Git Bash.exe"

# 5. Desktop shortcut
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Git Bash.lnk")
$lnk.TargetPath = "$dest\Git Bash.exe"
$lnk.WorkingDirectory = $env:USERPROFILE
$lnk.IconLocation = "$gitDir\mingw64\share\git\git-for-windows.ico,0"
$lnk.Save()
Write-Host "[OK] desktop shortcut created"

# 6. Start Menu patch (requires elevation; run separately if needed)
$smLnk = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Git\Git Bash.lnk"
if (Test-Path $smLnk) {
    try {
        $sm = $ws.CreateShortcut($smLnk)
        $sm.TargetPath = "$dest\Git Bash.exe"
        $sm.Arguments = ""
        $sm.WorkingDirectory = $env:USERPROFILE
        $sm.IconLocation = "$gitDir\mingw64\share\git\git-for-windows.ico,0"
        $sm.Save()
        Write-Host "[OK] Start Menu patched"
    } catch { Write-Host "[WARN] Start Menu patch needs elevation; run manually" }
} else { Write-Host "[SKIP] Start Menu entry not found" }

# 7. Extract icon (for the parked Discord Presence task)
Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::new("$gitDir\mingw64\share\git\git-for-windows.ico", 256, 256)
$bmp = $ico.ToBitmap()
$bmp.Save("$env:USERPROFILE\Desktop\gitbash-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $ico.Dispose()
Write-Host "[OK] icon extracted -> Desktop\gitbash-icon.png"

Write-Host ""
Write-Host "Setup complete. Open Git Bash via the desktop shortcut."
Write-Host "In Discord: Registered Games > Add it! > 'Git Bash'"
