@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
set PY="%~dp0..\stable-diffusion-portable-main\venv\Scripts\python.exe"
if not exist %PY% set PY="%~dp0..\stable-diffusion-portable-main\python\python.exe"
%PY% "%~dp0bridge.py"
pause
