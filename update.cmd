@echo off
setlocal enableextensions
cd /d "%~dp0"
title Обновление проекта

echo ========================================
echo   Обновление из Git
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Git не найден в PATH.
  echo Установи Git: https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

echo [1/3] Проверка локальных изменений...
git status --porcelain > "%TEMP%\git_status.txt"
for %%A in ("%TEMP%\git_status.txt") do set SIZE=%%~zA
if not "%SIZE%"=="0" (
  echo.
  echo [ВНИМАНИЕ] Есть незакоммиченные локальные изменения:
  git status --short
  echo.
  choice /C YN /M "Сохранить их в stash и продолжить"
  if errorlevel 2 (
    echo Отменено пользователем.
    del "%TEMP%\git_status.txt" >nul 2>nul
    pause
    exit /b 1
  )
  git stash push -u -m "auto-stash-before-update-%date%-%time%"
  if errorlevel 1 (
    echo [ОШИБКА] Не удалось сохранить изменения в stash.
    del "%TEMP%\git_status.txt" >nul 2>nul
    pause
    exit /b 1
  )
  echo Изменения сохранены в stash. Вернуть: git stash pop
)
del "%TEMP%\git_status.txt" >nul 2>nul

echo.
echo [2/3] Получение изменений с сервера...
git fetch --all --prune
if errorlevel 1 (
  echo [ОШИБКА] Не удалось связаться с репозиторием.
  pause
  exit /b 1
)

echo.
echo [3/3] Применение изменений...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Fast-forward pull не удался.
  echo Возможны расхождения с удалённой веткой.
  echo Разберись вручную: git status / git log
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Готово. Изменения применены.
echo ========================================
echo.

if exist "%~dp0package.json" (
  choice /C YN /M "Запустить npm install (если менялись зависимости)"
  if not errorlevel 2 (
    call npm install
  )
)

echo.
pause
exit /b 0