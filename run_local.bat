@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title MFDS Regulatory PWA - Local Launcher

set "RUN_LOG=run_local.log"
> "%RUN_LOG%" echo ==================================================
>> "%RUN_LOG%" echo %date% %time% MFDS Regulatory PWA local launch started
>> "%RUN_LOG%" echo App folder initialized
>> "%RUN_LOG%" echo ==================================================

if not exist "%RUN_LOG%" (
  echo ERROR: Cannot create run_local.log in this folder.
  echo Extract the zip to a normal local folder and run again.
  pause
  exit /b 1
)

echo ==================================================
echo  MFDS Regulatory PWA Local Launcher
echo ==================================================
echo.
echo This window will stay open if an error occurs.
echo Logs: run_local.log / server.log / client.log
echo.

call "%~dp0scripts\run_local_core.bat"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ==================================================
echo Exit code: %EXIT_CODE%
echo Check logs: run_local.log, server.log, client.log
echo ==================================================
echo.
>> "%RUN_LOG%" echo %date% %time% Launcher finished with exit code %EXIT_CODE%
pause
exit /b %EXIT_CODE%
