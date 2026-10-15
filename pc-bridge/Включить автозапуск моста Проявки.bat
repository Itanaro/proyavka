@echo off
rem Proyavka: puts the autostart file into the Windows Startup folder (run once; running again is safe).
set "SRC=D:\stable-diffusion-portable-main\proyavka-bridge\proyavka-bridge-autostart.vbs"
set "DST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\proyavka-bridge-autostart.vbs"
copy /Y "%SRC%" "%DST%" >nul
if exist "%DST%" (
  echo.
  echo   OK - autostart is ON.
  echo   One minute after Windows starts, the Proyavka bridge and Automatic1111 start by themselves.
  echo   To turn it off: Win+R, shell:startup, delete proyavka-bridge-autostart.vbs
) else (
  echo.
  echo   FAILED to copy. Do it by hand: Win+R, shell:startup, and drag this file there:
  echo   %SRC%
)
echo.
pause
