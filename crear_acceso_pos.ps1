$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\OneDrive\Escritorio\POS Padano.lnk")
$Shortcut.TargetPath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$Shortcut.Arguments = "--kiosk-printing http://localhost:5173/pos"
$Shortcut.Description = "POS Padano - Impresion directa"
$Shortcut.Save()
Write-Host "Acceso directo creado en el Escritorio"
