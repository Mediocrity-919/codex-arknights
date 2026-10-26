@echo off
cd /d "%~dp0"
if not exist "dist\ArkBoot.exe" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Build-Launcher.ps1"
if exist "dist\ArkBoot.exe" start "" "%~dp0dist\ArkBoot.exe" --auto
