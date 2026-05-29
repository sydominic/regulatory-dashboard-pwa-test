@echo off
setlocal
cd /d "%~dp0\.."

if not exist "server\node_modules" (
  echo [1/3] server dependencies installing...
  call npm --prefix server install --no-audit --no-fund
  if errorlevel 1 goto fail
)

echo [2/3] MFDS local collector starting...
node mfds_collector\collect_mfds_to_supabase.js --mode=fast --days=7
if errorlevel 1 goto fail

echo [3/3] done. Check mfds_collector\logs.
pause
exit /b 0

:fail
echo.
echo Collector failed. Check mfds_collector\logs\collect_error.log
pause
exit /b 1
