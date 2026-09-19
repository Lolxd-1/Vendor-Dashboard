@echo off
title QuickVerse Print Agent
echo Starting QuickVerse Print Agent v1.2.0 (pure PowerShell, no Node needed)...
echo Folder: %~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1"
echo.
echo Agent stopped. If you see an error above, fix it and try again.
pause
