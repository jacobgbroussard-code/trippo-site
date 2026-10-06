Write-Host "🛑 Stopping Trippo Telegram Bot..." -ForegroundColor Yellow

try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:8765/stop' -Method Post -TimeoutSec 2 | Out-Null
} catch {}

Start-Sleep -Milliseconds 600

Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*telegram-bridge.js*' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "   Terminated process PID $($_.ProcessId)" -ForegroundColor Gray
}

$pidFile = 'C:\Users\Jacob\Desktop\trippo-site\.bot.pid'
if (Test-Path $pidFile) {
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "✅ Trippo Bot is completely stopped." -ForegroundColor Red
Start-Sleep -Seconds 2
