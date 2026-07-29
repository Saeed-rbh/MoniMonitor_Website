@echo off
setlocal
cd /d "%~dp0"

echo Starting MoniMonitor...

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing website dependencies...
  call npm install
  if errorlevel 1 goto :error
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

start "MoniMonitor API + Email + Telegram" /D "%~dp0server" cmd /k "set AI_INGESTION_ENABLED=true && npm run dev"
timeout /t 2 /nobreak >nul
start "MoniMonitor Website" /D "%~dp0" cmd /k "npm run dev"

echo.
echo MoniMonitor services launched.
echo Website: http://localhost:3000
timeout /t 3 /nobreak >nul
exit /b 0

:error
echo.
echo MoniMonitor could not start. Review the error above.
pause
exit /b 1
