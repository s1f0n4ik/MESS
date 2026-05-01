@echo off
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"
title Обновление и перезапуск

set "LAUNCHER=запуск приложения.cmd"
set "LOGFILE=%~dp0update.log"

echo ======================================== > "%LOGFILE%"
echo   Update-and-restart %date% %time%       >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

echo ========================================
echo   Обновление и перезапуск проекта
echo ========================================
echo.

REM -- 1. Проверка git --
where git >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Git не найден в PATH.
  echo Установи Git: https://git-scm.com/download/win
  pause
  exit /b 1
)

REM -- 2. Запоминаем хеш package.json ДО обновления --
set "PKG_HASH_BEFORE="
if exist "%~dp0package.json" (
  for /f "delims=" %%H in ('certutil -hashfile "%~dp0package.json" MD5 ^| find /v ":" ^| find /v "CertUtil"') do set "PKG_HASH_BEFORE=%%H"
)

REM -- 3. Локальные изменения --
echo [1/5] Проверка локальных изменений...
git status --porcelain > "%TEMP%\git_status.txt"
for %%A in ("%TEMP%\git_status.txt") do set SIZE=%%~zA
if not "%SIZE%"=="0" (
  echo.
  echo Есть незакоммиченные локальные изменения:
  git status --short
  echo.
  choice /C YN /M "Сохранить их в stash и продолжить"
  if errorlevel 2 (
    echo Отменено пользователем.
    del "%TEMP%\git_status.txt" >nul 2>nul
    pause
    exit /b 1
  )
  git stash push -u -m "auto-stash-%date%-%time%" >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [ОШИБКА] Stash не удался.
    pause
    exit /b 1
  )
)
del "%TEMP%\git_status.txt" >nul 2>nul

REM -- 4. Git pull --
echo [2/5] Получение изменений из Git...
git fetch --all --prune >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [ОШИБКА] git fetch провалился. Подробности в update.log.
  pause
  exit /b 1
)
git pull --ff-only >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [ОШИБКА] git pull --ff-only провалился.
  echo Скорее всего у тебя расходятся истории.
  echo Открой Git Bash и разберись: git status / git log.
  pause
  exit /b 1
)

REM -- 5. Проверяем, изменился ли package.json --
set "NEED_NPM=0"
if exist "%~dp0package.json" (
  set "PKG_HASH_AFTER="
  for /f "delims=" %%H in ('certutil -hashfile "%~dp0package.json" MD5 ^| find /v ":" ^| find /v "CertUtil"') do set "PKG_HASH_AFTER=%%H"
  if not "!PKG_HASH_BEFORE!"=="!PKG_HASH_AFTER!" set "NEED_NPM=1"
  if not exist "%~dp0node_modules" set "NEED_NPM=1"
)

REM -- 6. Прибиваем старый сервер --
echo [3/5] Остановка старого сервера...
REM Убиваем node, запущенный из этой папки
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*%~dp0server.js*'.Replace('\','\\') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >> "%LOGFILE%" 2>&1

REM На всякий случай — грубо прибиваем все node.exe, если вдруг первый способ не сработал
REM (закомментируй строку ниже, если на ПК крутится ещё что-то на Node)
taskkill /F /IM node.exe /T >nul 2>nul

REM И окно браузера в киоске
taskkill /F /IM msedge.exe /T >nul 2>nul
taskkill /F /IM chrome.exe /T >nul 2>nul

timeout /t 2 /nobreak >nul

REM -- 7. npm install если нужно --
if "%NEED_NPM%"=="1" (
  echo [4/5] Обновление зависимостей npm...
  call npm install >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    echo [ОШИБКА] npm install провалился. Подробности в update.log.
    pause
    exit /b 1
  )
) else (
  echo [4/5] Зависимости без изменений, npm install пропущен.
)

REM -- 8. Запуск --
echo [5/5] Запуск приложения...
if exist "%~dp0%LAUNCHER%" (
  start "" "%~dp0%LAUNCHER%"
) else (
  echo [ОШИБКА] Не найден файл "%LAUNCHER%".
  echo Проверь имя файла в корне проекта.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Готово. Приложение перезапущено.
echo ========================================
timeout /t 3 /nobreak >nul
exit /b 0