@echo off
cd /d "%~dp0"
echo ========================================================
echo  Trippo - Deploy Live to GitHub Pages
echo ========================================================
echo.
"C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd" deploy-to-github.js
echo.
pause
