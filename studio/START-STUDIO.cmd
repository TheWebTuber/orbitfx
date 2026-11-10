@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for this local launcher.
  echo Install the LTS version from https://nodejs.org then run this file again.
  echo You can also upload this folder to your existing HTTPS website.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8787/content.html in Chrome or Edge.
node server.cjs
pause
