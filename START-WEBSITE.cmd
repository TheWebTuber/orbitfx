@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is required for the local preview launcher.
  echo Install from https://nodejs.org or use VS Code Live Server.
  pause
  exit /b 1
)
echo Website preview: http://127.0.0.1:8790/
echo Press Ctrl+C to stop.
node website-server.cjs
pause
