@echo off
cd /d "%~dp0"
rem Use system Node if installed, else Antigravity's bundled Node
set "NODE=node"
where node >nul 2>&1 || set NODE="C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd"
echo ========================================================
echo  Trippo - Deploy Live to GitHub Pages
echo ========================================================
echo.
call %NODE% deploy-to-github.js
echo.
pause
