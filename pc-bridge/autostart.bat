@echo off
rem Proyavka autostart: the bridge (through the Hermes tunnel) and Automatic1111, both hidden. Called by the vbs in Windows Startup.
set "B=D:\stable-diffusion-portable-main\proyavka-bridge"
set "SD=D:\stable-diffusion-portable-main\stable-diffusion-portable-main"
echo %date% %time% autostart >> "%B%\autostart.log"
rem 1. the bridge - same settings as the desktop restart shortcut: online through the Hermes tunnel, local addresses direct
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7861 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
set PYTHONIOENCODING=utf-8
set "HTTPS_PROXY=http://127.0.0.1:10877"
set "HTTP_PROXY=http://127.0.0.1:10877"
set "NO_PROXY=localhost,127.0.0.1,::1"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%SD%\venv\Scripts\pythonw.exe' -ArgumentList 'bridge.py' -WorkingDirectory '%B%' -RedirectStandardOutput '%B%\bridge.log' -RedirectStandardError '%B%\bridge.err.log'"
echo bridge started >> "%B%\autostart.log"
rem 2. Automatic1111 is NOT started automatically any more - start/stop it with "D:\stable-diffusion-portable-main\Stable Diffusion.bat"
