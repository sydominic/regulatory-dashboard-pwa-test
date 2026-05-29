@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "API_PORT=8892"
set "CLIENT_PORT=5292"
set "API_HEALTH=http://127.0.0.1:%API_PORT%/api/health"
set "CLIENT_URL=http://127.0.0.1:%CLIENT_PORT%"
set "RUN_LOG=run_local.log"
set "SERVER_LOG=server.log"
set "CLIENT_LOG=client.log"
set "NPM_CONFIG_UPDATE_NOTIFIER=false"
set "NPM_CONFIG_FUND=false"
set "NPM_CONFIG_AUDIT=false"

call :log "API:    %API_HEALTH%"
call :log "Client: %CLIENT_URL%"
call :log "Working directory check completed"

call :log "[1/9] Check folder structure"
if not exist "server\src\index.js" (
  call :log "ERROR: server\src\index.js is missing. The extracted folder structure is incorrect."
  exit /b 1
)
if not exist "client\package.json" (
  call :log "ERROR: client\package.json is missing. The extracted folder structure is incorrect."
  exit /b 1
)

call :log "[2/9] Check Node/npm"
where node >> "%RUN_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: node is not installed or not available in PATH."
  exit /b 1
)
node -v >> "%RUN_LOG%" 2>&1
where npm >> "%RUN_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: npm is not installed or not available in PATH."
  exit /b 1
)
rem IMPORTANT: npm on Windows is npm.cmd. It must be called with CALL inside a .bat file.
call npm -v >> "%RUN_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: npm version check failed."
  exit /b 1
)

call :log "[3/9] Check .env"
if exist ".env" (
  call :log ".env found. DATABASE_URL will be used if present."
) else (
  call :log "WARNING: .env not found. The app will run in local-json mode if supported."
  call :log "         To use Supabase/Postgres locally, add DATABASE_URL to .env."
)

call :log "[4/9] Stop existing local ports"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-ports.ps1" 8890 5290 8891 5291 %API_PORT% %CLIENT_PORT% >> "%RUN_LOG%" 2>&1

call :log "[5/9] Install server packages if needed"
if exist "server\node_modules\express" if exist "server\node_modules\@supabase\supabase-js" if exist "server\node_modules\ws" (
  call :log "Server packages already installed."
) else (
  call :log "Installing server packages..."
  call npm --prefix server install --no-audit --no-fund >> "%RUN_LOG%" 2>&1
  if errorlevel 1 (
    call :log "ERROR: server package install failed. See run_local.log."
    exit /b 1
  )
)

call :log "[6/9] Install client packages if needed"
if exist "client\node_modules\.bin\vite.cmd" if exist "client\node_modules\@vitejs\plugin-react" (
  call :log "Client packages already installed and Windows vite.cmd exists."
) else (
  call :log "Installing client packages..."
  if exist "client\node_modules" (
    call :log "Removing incompatible/incomplete client node_modules before reinstall."
    rmdir /s /q "client\node_modules" >> "%RUN_LOG%" 2>&1
  )
  call npm --prefix client install --no-audit --no-fund --legacy-peer-deps >> "%RUN_LOG%" 2>&1
  if errorlevel 1 (
    call :log "ERROR: client package install failed. See run_local.log."
    exit /b 1
  )
)

call :log "[7/9] Start API server"
del "%SERVER_LOG%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-hidden.ps1" -ScriptPath "%CD%\start_server.bat"
call :wait_url "%API_HEALTH%" "API server" "%SERVER_LOG%"
if errorlevel 1 exit /b 1

call :log "[7.5/9] Verify API version"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=Invoke-RestMethod -Uri '%API_HEALTH%' -TimeoutSec 5; if ($r.apiVersion -ne 'v1.3-node-render-raw-diagnostic') { Write-Output ('ERROR: expected v1.3-node-render-raw-diagnostic but got ' + $r.apiVersion); exit 1 } else { Write-Output ('API version OK: ' + $r.apiVersion); exit 0 }" >> "%RUN_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: API version mismatch. Old server may still be running. See run_local.log."
  exit /b 1
)


call :log "[8/9] Start React client"
del "%CLIENT_LOG%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-hidden.ps1" -ScriptPath "%CD%\start_client.bat"
call :wait_url "%CLIENT_URL%" "React client" "%CLIENT_LOG%"
if errorlevel 1 exit /b 1

call :log "[9/9] Open browser"
start "" "%CLIENT_URL%"
call :log "Local app opened."
call :log "App URL: %CLIENT_URL%"
call :log "API health: %API_HEALTH%"
exit /b 0

:wait_url
set "WAIT_URL=%~1"
set "WAIT_NAME=%~2"
set "WAIT_LOG=%~3"
set /a WAIT_COUNT=0
call :log "Waiting for %WAIT_NAME%: %WAIT_URL%"
:wait_loop
set /a WAIT_COUNT+=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-url.ps1" -Url "%WAIT_URL%" >> "%RUN_LOG%" 2>&1
if not errorlevel 1 (
  call :log "%WAIT_NAME% ready."
  exit /b 0
)
if %WAIT_COUNT% GEQ 90 goto wait_failed
timeout /t 1 /nobreak >nul
goto wait_loop
:wait_failed
call :log "ERROR: %WAIT_NAME% did not become ready."
call :log "----- %WAIT_LOG% tail -----"
if "%WAIT_LOG%"=="" goto wait_log_missing
if exist "%WAIT_LOG%" goto wait_log_exists
goto wait_log_not_created
:wait_log_missing
call :log "No log file argument was provided."
echo No log file argument was provided.
exit /b 1
:wait_log_exists
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%WAIT_LOG%' -Tail 120" >> "%RUN_LOG%" 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%WAIT_LOG%' -Tail 80"
exit /b 1
:wait_log_not_created
call :log "%WAIT_LOG% not created"
echo %WAIT_LOG% not created
exit /b 1

:log
echo %~1
>> "%RUN_LOG%" echo %date% %time% %~1
exit /b 0
