Add-Type -AssemblyName System.Drawing
$src = "C:\Users\Jacob\.gemini\antigravity-ide\brain\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1\trippo_bot_icon_1791240330288.jpg"
$destPng = "c:\Users\Jacob\Desktop\trippo-site\bot-controls\bot-icon.png"
$destIco = "c:\Users\Jacob\Desktop\trippo-site\bot-controls\bot-icon.ico"

$img = [System.Drawing.Image]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap($img, 128, 128)
$bmp.Save($destPng, [System.Drawing.Imaging.ImageFormat]::Png)

$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream($destIco, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$img.Dispose()
$bmp.Dispose()
Write-Host "Icons generated successfully!"
