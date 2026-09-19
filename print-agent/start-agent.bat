@echo off
title QuickVerse Print Agent
echo Starting QuickVerse Print Agent...
echo Folder: %~dp0
node "%~dp0server.js"
echo.
echo Agent stopped. If you see an error above, fix it and try again.
pause
