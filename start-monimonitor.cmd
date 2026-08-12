@echo off
setlocal
cd /d "%~dp0"

set "PUBLIC_URL=https://monimonitor.saeedarabha.com"
set "PUBLIC_HEALTH_URL=%PUBLIC_URL%/api/health"
set "TAILSCALE_EXE=C:\Program Files\Tailscale\tailscale.exe"
set "AUTO_UPDATE_RESTART="
if /I "%~1"=="--auto-update-restart" set "AUTO_UPDATE_RESTART=1"

rem Tailscale Funnel uses an administrator-only control pipe on Windows.
rem Elevate the complete launcher so a successful start always includes Funnel.
powershell -NoProfile -Command "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Administrator access is required to manage the public tunnel.
  echo Requesting permission through Windows User Account Control...
  set "MONIMONITOR_LAUNCHER=%~f0"
  set "MONIMONITOR_RESTART_ARG=--elevated"
  if defined AUTO_UPDATE_RESTART set "MONIMONITOR_RESTART_ARG=--auto-update-restart"
  powershell -NoProfile -Command "Start-Process -FilePath $env:MONIMONITOR_LAUNCHER -ArgumentList $env:MONIMONITOR_RESTART_ARG -WorkingDirectory (Split-Path -Parent $env:MONIMONITOR_LAUNCHER) -Verb RunAs"
  if errorlevel 1 (
    echo MoniMonitor could not request administrator access.
    goto :error
  )
  exit /b 0
)

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
  call :ensure_public_health
  if errorlevel 1 goto :error
  echo MoniMonitor is already fully running.
  if not defined AUTO_UPDATE_RESTART start "" "%PUBLIC_URL%"
  powershell -NoProfile -Command "Start-Sleep -Seconds 3"
  exit /b 0
)

powershell -NoProfile -Command "$command = 'title MoniMonitor API + Email + Telegram&& set AI_INGESTION_ENABLED=true&& npm run dev'; $process = Start-Process -FilePath $env:ComSpec -ArgumentList '/d','/k',$command -WorkingDirectory '%~dp0server' -PassThru; Set-Content -LiteralPath (Join-Path $env:TEMP 'monimonitor-api.pid') -Value $process.Id"
if errorlevel 1 goto :error

echo Waiting for the backend to become ready...
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(60); do { try { Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo The backend did not become healthy within 60 seconds.
  goto :error
)
powershell -NoProfile -Command "$agent = Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' | Where-Object { $_.CommandLine -match 'email_agent\.js' }; if ($agent) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo The API is healthy, but the email and Telegram agent was not detected.
  goto :error
)

call :ensure_public_health
if errorlevel 1 goto :error

echo.
echo Website, API, email analyzer, Telegram connector, and tunnel are running.
echo Website: %PUBLIC_URL%
if not defined AUTO_UPDATE_RESTART start "" "%PUBLIC_URL%"
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

:ensure_public_health
rem Do not report success based only on local processes or Funnel configuration.
rem Verify the same public route used by the deployed website, repairing Funnel
rem between attempts in case Windows resumed with stale networking state.
echo Verifying the public website can reach the API...
for /L %%A in (1,1,6) do (
  powershell -NoProfile -Command "try { $health = Invoke-RestMethod -Uri '%PUBLIC_HEALTH_URL%' -TimeoutSec 5; if ($health.status -eq 'ok') { exit 0 } } catch {}; exit 1"
  if not errorlevel 1 (
    echo Public API health check passed.
    exit /b 0
  )

  echo Public API is not reachable yet. Repairing Funnel ^(%%A/6^)...
  "%TAILSCALE_EXE%" funnel --bg 3001 >nul 2>&1
  timeout /t 5 /nobreak >nul
)

echo The local API is healthy, but %PUBLIC_HEALTH_URL% is still unavailable.
echo Check the Tailscale status and Vercel rewrite before using the website.
exit /b 1

:error
echo.
echo MoniMonitor could not start. Review the error above.
pause
exit /b 1
