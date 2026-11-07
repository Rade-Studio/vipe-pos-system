@echo off
rem Run with right click > Run as administrator.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-VipeCertificate.ps1" -Remove
echo.
pause
