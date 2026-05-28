@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0client"
title MFDS React Client - port 5292

> "..\client.log" echo ==================================================
>> "..\client.log" echo %date% %time% Client launcher started

set "NPM_CONFIG_UPDATE_NOTIFIER=false"
set "NPM_CONFIG_FUND=false"
set "NPM_CONFIG_AUDIT=false"

echo ==================================================
echo  MFDS Regulatory React Client - port 5292
echo ==================================================
echo Log file: ..\client.log
echo.

rem Windows needs node_modules\.bin\vite.cmd. Linux node_modules copied from zip will not work.
if not exist "node_modules\.bin\vite.cmd" (
  echo [setup] Installing client packages for Windows...
  >> "..\client.log" echo %date% %time% Installing client packages because vite.cmd is missing
  if exist "node_modules" (
    >> "..\client.log" echo %date% %time% Removing incompatible/incomplete client node_modules
    rmdir /s /q "node_modules" >> "..\client.log" 2>&1
  )
  call npm install --no-audit --no-fund --legacy-peer-deps >> "..\client.log" 2>&1
  if errorlevel 1 (
    echo ERROR: client package install failed. See client.log.
    >> "..\client.log" echo %date% %time% ERROR client package install failed
    pause
    exit /b 1
  )
)

if not exist "node_modules\.bin\vite.cmd" (
  echo ERROR: vite.cmd is still missing after npm install. See client.log.
  >> "..\client.log" echo %date% %time% ERROR vite.cmd still missing after install
  pause
  exit /b 1
)

echo [run] npm run dev
>> "..\client.log" echo %date% %time% Running npm run dev
call npm run dev >> "..\client.log" 2>&1

set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Client process ended with code %EXIT_CODE%.
echo Last client.log lines:
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path -LiteralPath '..\client.log') { Get-Content -LiteralPath '..\client.log' -Tail 80 }"
echo.
echo Press any key to close.
pause >nul
exit /b %EXIT_CODE%
