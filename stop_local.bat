@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
echo Stopping local ports 8890, 5290, 8891, 5291, 8892 and 5292...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-ports.ps1" -Ports 8890,5290,8891,5291,8892,5292
pause
