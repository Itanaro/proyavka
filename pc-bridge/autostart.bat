@echo off
chcp 65001 >nul
rem Proyavka autostart: the bridge (through the Hermes tunnel) and Automatic1111, both hidden. Called by the vbs in Windows Startup.
set "B=D:\stable-diffusion-portable-main\proyavka-bridge"
echo %date% %time% autostart >> "%B%\autostart.log"
rem 1. the bridge - the same way as the desktop shortcut (keeps the tunnel settings)
call "%USERPROFILE%\Desktop\Перезапустить мост Проявки.bat" >> "%B%\autostart.log" 2>&1
rem 2. Automatic1111 - only if it is not running yet (a second copy would take port 7861 from the bridge)
netstat -ano | findstr ":7860 " | findstr "LISTENING" >nul && (echo SD already running >> "%B%\autostart.log" & exit /b)
cd /d "D:\stable-diffusion-portable-main\stable-diffusion-portable-main"
call webui-user.bat > "%B%\sd-autostart.log" 2>&1
