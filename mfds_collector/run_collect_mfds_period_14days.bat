@echo off
setlocal
cd /d "%~dp0\.."
if not exist "server\node_modules" call npm --prefix server install --no-audit --no-fund
node mfds_collector\collect_mfds_to_supabase.js --mode=period --days=14
pause
