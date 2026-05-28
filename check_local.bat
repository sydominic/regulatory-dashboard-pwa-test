@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
echo Checking local API and client...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\check-url.ps1" -Url "http://127.0.0.1:8892/api/health"
echo API exit code: %ERRORLEVEL%
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\check-url.ps1" -Url "http://127.0.0.1:5292"
echo Client exit code: %ERRORLEVEL%
pause
