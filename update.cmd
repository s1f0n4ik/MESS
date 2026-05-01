@echo off
chcp 65001 >nul
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"
title Update and restart

set "LAUNCHER=start-app.cmd"
set "LOGFILE=%~dp0update.log"
set "SERVER_PORT=8787"

echo ======================================== > "%LOGFILE%"
echo   Update-and-restart %date% %time%        >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

echo ========================================
echo   Update and restart
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git not found in PATH.
  pause
  exit /b 1
)

set "PKG_HASH_BEFORE="
if exist "%~dp0package.json" (
  for /f "delims=" %%H in ('certutil -hashfile "%~dp0package.json" MD5 ^| find /v ":" ^| find /v "CertUtil"') do set "PKG_HASH_BEFORE=%%H"
)

echo [1/5] Check local changes...
git status --porcelain > "%TEMP%\git_status.txt"
for %%A in ("%TEMP%\git_status.txt") do set SIZE=%%~zA
if not "%SIZE%"=="0" (
  echo.
  echo Local uncommitted changes found:
  git status --short
  echo.
  choice /C YN /M "Stash them and continue"
  if errorlevel 2 (
    echo Cancelled.
    del "%TEMP%\git_status.txt" >nul 2>nul
    pause
    exit /b 1
  )
  git stash push -u -m "auto-stash-%random%" >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [ERROR] stash failed.
    pause
    exit /b 1
  )
)
del "%TEMP%\git_status.txt" >nul 2>nul

echo [2/5] Fetching from remote...
git fetch --all --prune >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] git fetch failed. See update.log.
  pause
  exit /b 1
)
git pull --ff-only >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] git pull --ff-only failed. See update.log.
  pause
  exit /b 1
)

set "NEED_NPM=0"
if exist "%~dp0package.json" (
  set "PKG_HASH_AFTER="
  for /f "delims=" %%H in ('certutil -hashfile "%~dp0package.json" MD5 ^| find /v ":" ^| find /v "CertUtil"') do set "PKG_HASH_AFTER=%%H"
  if not "!PKG_HASH_BEFORE!"=="!PKG_HASH_AFTER!" set "NEED_NPM=1"
  if not exist "%~dp0node_modules" set "NEED_NPM=1"
)

echo [3/5] Stopping old server...
REM Точечно: только node.exe, который слушает наш порт
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%SERVER_PORT%" ^| findstr "LISTENING"') do (
  echo Killing PID %%P >> "%LOGFILE%"
  taskkill /F /PID %%P >> "%LOGFILE%" 2>&1
)

REM Закрываем старые окна браузера-киоска
taskkill /F /IM msedge.exe /T >nul 2>nul
taskkill /F /IM chrome.exe /T >nul 2>nul

timeout /t 2 /nobreak >nul

if "%NEED_NPM%"=="1" (
  echo [4/5] npm install...
  call npm install >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [ERROR] npm install failed. See update.log.
    pause
    exit /b 1
  )
) else (
  echo [4/5] Dependencies unchanged, skipping npm install.
)

echo [5/5] Launching app...
if not exist "%~dp0%LAUNCHER%" (
  echo [ERROR] Launcher not found: %LAUNCHER%
  echo Rename your launch file to start-app.cmd
  pause
  exit /b 1
)
start "" cmd /c "%~dp0%LAUNCHER%"

echo.
echo ========================================
echo   Done. App restarted.
echo ========================================
timeout /t 3 /nobreak >nul
exit /b 0