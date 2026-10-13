@echo off
title Trippo Live Auto-Deploy Watcher
cd /d "%~dp0"
rem Use system Node if installed, else Antigravity's bundled Node
set "NODE=node"
where node >nul 2>&1 || set NODE="C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd"
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
call %NODE% watch-deploy.js
pause
