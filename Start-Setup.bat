@echo off
title QuickVerse Shop Setup v1.3.2
echo QuickVerse 2-min shop setup...
echo Dashboard: https://vendor-dashboard-quickverse.vercel.app/
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\Install-QuickVerse.ps1" -SiteUrl "https://vendor-dashboard-quickverse.vercel.app/" -AddToStartup -NoSleep
echo.
echo Setup finished. Open the "QuickVerse Vendor" desktop shortcut and log in.
pause
