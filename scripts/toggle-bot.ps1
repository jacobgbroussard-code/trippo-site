$siteDir = 'C:\Users\Jacob\Desktop\trippo-site'
$agyNode = 'C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd'
$bridgeScript = 'C:\Users\Jacob\Desktop\trippo-site\telegram-bridge.js'

$isOnline = $false
try {
    $stat = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 2
    if ($stat.status -eq 'online') {
        $isOnline = $true
    }
} catch {}

if ($isOnline) {
    Write-Host "🛑 Trippo Bot is currently RUNNING (Uptime: $($stat.uptimeSeconds)s)." -ForegroundColor Yellow
    Write-Host "Shutting down..."
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:8765/stop' -Method Post -TimeoutSec 2 | Out-Null
    } catch {}
    Start-Sleep -Milliseconds 500
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*telegram-bridge.js*' } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "✅ Trippo Bot has been turned OFF." -ForegroundColor Red
} else {
    Write-Host "🚀 Trippo Bot is currently OFF. Starting in background..." -ForegroundColor Cyan
    $cmd = "cmd.exe /c `"$agyNode $bridgeScript`""
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $siteDir }
    Start-Sleep -Seconds 2
    try {
        $stat = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 3
        Write-Host "✅ Trippo Bot is now ONLINE and listening!" -ForegroundColor Green
        Write-Host "   Memory: $($stat.memoryMB) MB | User: $($stat.allowedUserId)" -ForegroundColor Gray
    } catch {
        Write-Host "⚠️ Bot started (PID: $($res.ProcessId)), verifying background listener..." -ForegroundColor Yellow
    }
}

Start-Sleep -Seconds 2
