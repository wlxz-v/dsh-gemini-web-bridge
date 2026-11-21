# install-daemon.ps1 — Installs silent Windows startup shortcut for Gemini Web Bridge

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$vbsPath = Join-Path $scriptDir "run-hidden.vbs"
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup')
$shortcutPath = Join-Path $startupFolder "Gemini-Web-Bridge.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$vbsPath`""
$Shortcut.WorkingDirectory = Join-Path $scriptDir "bin"
$Shortcut.WindowStyle = 7 # Minimized
$Shortcut.Description = "Gemini Web 4 Auto-Start Daemon for DeepSeek Harness"
$Shortcut.Save()

Write-Output "[OK] Startup shortcut installed to: $shortcutPath"

# Run it immediately via wscript
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`""
Start-Sleep -Seconds 1
Write-Output "[OK] Silent background daemon launched."
