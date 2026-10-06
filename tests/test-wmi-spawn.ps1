$cmd = 'cmd.exe /c "C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd C:\Users\Jacob\Desktop\trippo-site\telegram-bridge.js"'
$dir = 'C:\Users\Jacob\Desktop\trippo-site'

$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $dir }
Write-Host "Created PID: $($res.ProcessId), Return: $($res.ReturnValue)"
Start-Sleep -Seconds 4

try {
    $stat = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status'
    Write-Host "Status: $($stat.status), Memory: $($stat.memoryMB) MB, PID: $($stat.uptimeSeconds)"
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}
