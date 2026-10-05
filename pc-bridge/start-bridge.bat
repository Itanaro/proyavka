@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
"%~dp0..\stable-diffusion-portable-main\python\python.exe" "%~dp0bridge.py"
pause
