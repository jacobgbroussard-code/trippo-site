$siteDir = 'C:\Users\Jacob\Desktop\trippo-site'
$agyNode = 'C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd'
$bridgeScript = 'C:\Users\Jacob\Desktop\trippo-site\telegram-bridge.js'

try {
    $stat = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 2
    if ($stat.status -eq 'online') {
        Write-Host "🟢 Trippo Bot is ALREADY RUNNING (Uptime: $($stat.uptimeSeconds)s)." -ForegroundColor Green
        Start-Sleep -Seconds 2
        exit 0
    }
} catch {}

Write-Host "🚀 Starting Trippo Telegram Bot in the background..." -ForegroundColor Cyan
$cmd = "cmd.exe /c `"$agyNode $bridgeScript`""
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $siteDir }
Start-Sleep -Seconds 2

try {
    $stat = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 3
    Write-Host "✅ Trippo Bot is now ONLINE and ready!" -ForegroundColor Green
    Write-Host "   Memory: $($stat.memoryMB) MB | User: $($stat.allowedUserId)" -ForegroundColor Gray
} catch {
    Write-Host "⚠️ Bot process created (PID: $($res.ProcessId)). Initializing..." -ForegroundColor Yellow
}

Start-Sleep -Seconds 2
