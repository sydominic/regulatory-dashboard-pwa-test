@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title MFDS API Server - port 8892

set "SERVER_LOG=server.log"
> "%SERVER_LOG%" echo ==================================================
>> "%SERVER_LOG%" echo %date% %time% Server launcher started

set "LOCAL_API_PORT=8892"
set "HOST=127.0.0.1"
set "NPM_CONFIG_UPDATE_NOTIFIER=false"
set "NPM_CONFIG_FUND=false"
set "NPM_CONFIG_AUDIT=false"

echo ==================================================
echo  MFDS Regulatory API Server - port 8892
echo ==================================================
echo Log file: server.log
echo.

if not exist "server\node_modules\express" goto install_server_packages
if not exist "server\node_modules\@supabase\supabase-js" goto install_server_packages
if not exist "server\node_modules\ws" goto install_server_packages
goto server_packages_ready

:install_server_packages
if exist "server\package.json" (
  echo [setup] Installing server packages...
  >> "%SERVER_LOG%" echo %date% %time% Installing server packages...
  call npm --prefix server install --no-audit --no-fund >> "%SERVER_LOG%" 2>&1
  if errorlevel 1 (
    echo ERROR: server package install failed. See server.log.
    >> "%SERVER_LOG%" echo %date% %time% ERROR server package install failed
    pause
    exit /b 1
  )
)

:server_packages_ready
echo [run] node server/src/index.js
>> "%SERVER_LOG%" echo %date% %time% Running node server/src/index.js
call node server/src/index.js >> "%SERVER_LOG%" 2>&1

set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Server process ended with code %EXIT_CODE%.
echo Last server.log lines:
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path -LiteralPath 'server.log') { Get-Content -LiteralPath 'server.log' -Tail 80 }"
echo.
echo Press any key to close.
pause >nul
exit /b %EXIT_CODE%
