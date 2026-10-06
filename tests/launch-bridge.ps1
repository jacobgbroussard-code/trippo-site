$ErrorActionPreference = 'Continue'
$agyNode = 'C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd'
$script = 'C:\Users\Jacob\Desktop\trippo-site\telegram-bridge.js'
$siteDir = 'C:\Users\Jacob\Desktop\trippo-site'

Write-Host "1. Starting process..."
Start-Process -FilePath $agyNode -ArgumentList $script -WorkingDirectory $siteDir -WindowStyle Hidden

Write-Host "2. Waiting 3 seconds for boot..."
Start-Sleep -Seconds 3

Write-Host "3. Checking local server on 8765..."
try {
    $res = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 5
    Write-Host "STATUS RESULT: $($res.status), memory: $($res.memoryMB) MB, user: $($res.allowedUserId)"
} catch {
    Write-Host "STATUS FAILED: $($_.Exception.Message)"
}
