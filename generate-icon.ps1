Add-Type -AssemblyName System.Drawing
$src = "c:\Users\Jacob\Desktop\trippo-site\bot-controls\bot-icon-source.jpg"
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
