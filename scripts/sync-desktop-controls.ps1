$ErrorActionPreference = 'Stop'
$ctrlDir = 'C:\Users\Jacob\Desktop\Trippo Bot Controls'
$siteDir = 'C:\Users\Jacob\Desktop\trippo-site'

if (-not (Test-Path $ctrlDir)) {
    New-Item -ItemType Directory -Path $ctrlDir -Force | Out-Null
}

# 1. Clean old weird filenames
Get-ChildItem -Path $ctrlDir | Where-Object { $_.Name -like '*Stop Bot.cmd' -or $_.Name -like '*Start Bot*' -or $_.Name -like '*Toggle Bot*' } | Remove-Item -Force

# 2. Write clean Start Bot.cmd
$startContent = @"
@echo off
title Start Trippo Telegram Bot
cd /d "C:\Users\Jacob\Desktop\trippo-site"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Jacob\Desktop\trippo-site\scripts\start-bot.ps1"
"@
[System.IO.File]::WriteAllText((Join-Path $ctrlDir 'Start Bot.cmd'), $startContent, [System.Text.Encoding]::ASCII)

# 3. Write clean Stop Bot.cmd
$stopContent = @"
@echo off
title Stop Trippo Telegram Bot
cd /d "C:\Users\Jacob\Desktop\trippo-site"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Jacob\Desktop\trippo-site\scripts\stop-bot.ps1"
"@
[System.IO.File]::WriteAllText((Join-Path $ctrlDir 'Stop Bot.cmd'), $stopContent, [System.Text.Encoding]::ASCII)

# 4. Write clean Toggle Bot.cmd
$toggleContent = @"
@echo off
title Toggle Trippo Telegram Bot
cd /d "C:\Users\Jacob\Desktop\trippo-site"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Jacob\Desktop\trippo-site\scripts\toggle-bot.ps1"
"@
[System.IO.File]::WriteAllText((Join-Path $ctrlDir 'Toggle Bot.cmd'), $toggleContent, [System.Text.Encoding]::ASCII)

# 5. Create or update Desktop shortcut
$sh = New-Object -ComObject WScript.Shell
$lnkPath = 'C:\Users\Jacob\Desktop\Trippo Bot & Analytics.lnk'
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $ctrlDir 'Bot Control Dashboard.html'
$lnk.WorkingDirectory = $ctrlDir
$lnk.IconLocation = Join-Path $ctrlDir 'bot-icon.ico, 0'
$lnk.Description = 'Trippo Telegram Bot & Antigravity Telemetry Dashboard'
$lnk.Save()

Write-Host "Desktop controls and shortcut synced successfully!"
Get-ChildItem $ctrlDir | Select-Object Name, Length
Write-Host "Desktop shortcut TargetPath: $($lnk.TargetPath)"
