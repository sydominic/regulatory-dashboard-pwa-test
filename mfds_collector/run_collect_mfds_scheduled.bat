@echo off
setlocal
cd /d "%~dp0\.."
if not exist "server\node_modules" call npm --prefix server install --no-audit --no-fund >> mfds_collector\logs\scheduled_collect.log 2>&1
node mfds_collector\collect_mfds_to_supabase.js --mode=fast --days=7 >> mfds_collector\logs\scheduled_collect.log 2>&1
exit /b %ERRORLEVEL%
