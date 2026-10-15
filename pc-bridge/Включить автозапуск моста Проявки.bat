@echo off
chcp 65001 >nul
rem Puts the bridge autostart file into the Windows Startup folder (run once).
set "SRC=D:\stable-diffusion-portable-main\proyavka-bridge\proyavka-bridge-autostart.vbs"
set "DST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\proyavka-bridge-autostart.vbs"
copy /Y "%SRC%" "%DST%" >nul
if exist "%DST%" (
  echo Готово: мост Проявки будет сам запускаться через минуту после включения компьютера.
  echo Выключить автозапуск: Win+R, shell:startup, удалить proyavka-bridge-autostart.vbs
) else (
  echo Не получилось скопировать. Сделай вручную: Win+R, shell:startup и перетащи туда
  echo %SRC%
)
pause
