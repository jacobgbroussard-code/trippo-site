@echo off
title Trippo Live Auto-Deploy Watcher
cd /d "%~dp0"
echo ========================================================
echo   Trippo Travel Planner - Live Auto-Deploy Active
echo ========================================================
echo Watching folder for edits...
echo Whenever you save index.html, styles, or js,
echo your live site at https://trippo.top will update!
echo.
echo (Keep this window open while editing)
echo ========================================================
echo.
"C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd" watch-deploy.js
pause
