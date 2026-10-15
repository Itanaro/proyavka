@echo off
rem Proyavka autostart: the bridge (through the Hermes tunnel) and Automatic1111, both hidden. Called by the vbs in Windows Startup.
set "B=D:\stable-diffusion-portable-main\proyavka-bridge"
set "SD=D:\stable-diffusion-portable-main\stable-diffusion-portable-main"
echo %date% %time% autostart >> "%B%\autostart.log"
rem 1. the bridge - same settings as the desktop restart shortcut: online through the Hermes tunnel, local addresses direct
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7861" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
set PYTHONIOENCODING=utf-8
set "HTTPS_PROXY=http://127.0.0.1:10877"
set "HTTP_PROXY=http://127.0.0.1:10877"
set "NO_PROXY=localhost,127.0.0.1,::1"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%SD%\venv\Scripts\python.exe' -ArgumentList 'bridge.py' -WorkingDirectory '%B%' -RedirectStandardOutput '%B%\bridge.log' -RedirectStandardError '%B%\bridge.err.log'"
echo bridge started >> "%B%\autostart.log"
rem 2. Automatic1111 - only if it is not running yet (a second copy would take port 7861 from the bridge)
set "HTTPS_PROXY=" & set "HTTP_PROXY=" & set "NO_PROXY="
netstat -ano | findstr ":7860 " | findstr "LISTENING" >nul && (echo SD already running >> "%B%\autostart.log" & exit /b)
echo SD starting >> "%B%\autostart.log"
cd /d "%SD%"
call webui-user.bat > "%B%\sd-autostart.log" 2>&1
