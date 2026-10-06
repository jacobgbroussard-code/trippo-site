$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "C:\Users\Jacob\AppData\Local\Programs\antigravity\Antigravity.exe"
$psi.Arguments = "C:\Users\Jacob\Desktop\trippo-site\telegram-bridge.js"
$psi.WorkingDirectory = "C:\Users\Jacob\Desktop\trippo-site"
$psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$process = [System.Diagnostics.Process]::Start($psi)

Write-Host "Started process PID: $($process.Id)"
Start-Sleep -Seconds 5

try {
    $res = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 3
    Write-Host "STATUS CHECK 1 (5s): $($res.status), memory: $($res.memoryMB) MB"
} catch {
    Write-Host "STATUS CHECK 1 FAILED: $($_.Exception.Message)"
}

Start-Sleep -Seconds 5

try {
    $res2 = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 3
    Write-Host "STATUS CHECK 2 (10s): $($res2.status), memory: $($res2.memoryMB) MB"
} catch {
    Write-Host "STATUS CHECK 2 FAILED: $($_.Exception.Message)"
}
