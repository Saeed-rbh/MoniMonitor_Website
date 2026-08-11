@echo off
setlocal
cd /d "%~dp0"

set "PUBLIC_URL=https://monimonitor.saeedarabha.com"
set "TAILSCALE_EXE=C:\Program Files\Tailscale\tailscale.exe"

echo Starting MoniMonitor public services...

call :update_from_github
call :ensure_auto_updater

if not exist "%TAILSCALE_EXE%" (
  echo Tailscale is not installed in the expected location.
  goto :error
)

if not exist "server\node_modules\.bin\concurrently.cmd" (
  echo Installing server dependencies...
  pushd "server"
  call npm install
  if errorlevel 1 (
    popd
    goto :error
  )
  popd
)

echo Ensuring the secure public tunnel is active...
call :ensure_tunnel
if errorlevel 1 goto :error

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  powershell -NoProfile -Command "$agent = Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' | Where-Object { $_.CommandLine -match 'email_agent\.js' }; if ($agent) { exit 0 } else { exit 1 }"
  if errorlevel 1 (
    echo The API is running without the email and Telegram agent. Close the existing backend window, then run this launcher again.
    goto :error
  )
  echo MoniMonitor is already fully running.
  start "" "%PUBLIC_URL%"
  powershell -NoProfile -Command "Start-Sleep -Seconds 3"
  exit /b 0
)

powershell -NoProfile -Command "$command = 'title MoniMonitor API + Email + Telegram&& set AI_INGESTION_ENABLED=true&& npm run dev'; $process = Start-Process -FilePath $env:ComSpec -ArgumentList '/d','/k',$command -WorkingDirectory '%~dp0server' -PassThru; Set-Content -LiteralPath (Join-Path $env:TEMP 'monimonitor-api.pid') -Value $process.Id"
if errorlevel 1 goto :error

echo Waiting for the backend to become ready...
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(20); do { try { Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 goto :error
powershell -NoProfile -Command "$agent = Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' | Where-Object { $_.CommandLine -match 'email_agent\.js' }; if ($agent) { exit 0 } else { exit 1 }"
if errorlevel 1 goto :error

echo.
echo Website, API, email analyzer, Telegram connector, and tunnel are running.
echo Website: %PUBLIC_URL%
start "" "%PUBLIC_URL%"
powershell -NoProfile -Command "Start-Sleep -Seconds 3"
exit /b 0

:update_from_github
echo Checking GitHub for MoniMonitor updates...

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or is not available in PATH. Skipping automatic update.
  exit /b 0
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo This folder is not a Git repository. Skipping automatic update.
  exit /b 0
)

set "CURRENT_BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if /I not "%CURRENT_BRANCH%"=="main" (
  echo Current branch is not main. Skipping automatic update.
  exit /b 0
)

for /f "delims=" %%G in ('git status --porcelain 2^>nul') do (
  echo Local changes were found. Skipping automatic update to protect them.
  exit /b 0
)

git fetch origin main
if errorlevel 1 (
  echo Could not check GitHub. Continuing with the existing local version.
  exit /b 0
)

git merge --ff-only origin/main
if errorlevel 1 (
  echo The local and GitHub histories have diverged. Automatic update was skipped.
  exit /b 0
)

echo MoniMonitor is up to date.
exit /b 0

:ensure_auto_updater
if not exist "%~dp0monimonitor-auto-update.ps1" (
  echo Automatic update watcher was not found. Continuing without background updates.
  exit /b 0
)

start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0monimonitor-auto-update.ps1"
exit /b 0

:ensure_tunnel
rem The Tailscale Windows service can briefly report NoState during login or
rem resume. Wait for the daemon and retry Funnel instead of failing immediately.
for /L %%A in (1,1,10) do (
  "%TAILSCALE_EXE%" status --json >nul 2>&1
  if not errorlevel 1 (
    "%TAILSCALE_EXE%" funnel --bg 3001 >nul 2>&1
    if not errorlevel 1 exit /b 0
  )
  echo Tailscale is not ready yet. Retrying tunnel setup ^(%%A/10^)...
  timeout /t 2 /nobreak >nul
)

echo Tailscale did not become ready after 20 seconds.
echo Current Tailscale status:
"%TAILSCALE_EXE%" status
echo Final Funnel attempt:
"%TAILSCALE_EXE%" funnel --bg 3001
exit /b 1

:error
echo.
echo MoniMonitor could not start. Review the error above.
pause
exit /b 1
