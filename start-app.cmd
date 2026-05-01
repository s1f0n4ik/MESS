@echo off
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"
set "LOGFILE=%~dp0server-launch.log"
echo ==== %date% %time% ==== > "%LOGFILE%"

set "NODEEXE="
for /f "delims=" %%I in ('where node 2^>nul') do (
  set "NODEEXE=%%I"
  goto :node_found
)
if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODEEXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODEEXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODEEXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODEEXE=%LocalAppData%\Programs\nodejs\node.exe"

:node_found
if not defined NODEEXE (
  echo Node.js not found>>"%LOGFILE%"
  echo Node.js not found. Install Node.js LTS and run this file again.
  pause
  exit /b 1
)

echo Using node: %NODEEXE%>>"%LOGFILE%"

if not exist "%~dp0node_modules\express" (
  echo Installing dependencies>>"%LOGFILE%"
  call npm install >> "%LOGFILE%" 2>&1
)

start "postcards-server" /min cmd /c "cd /d "%~dp0" && "%NODEEXE%" server.js >> "%LOGFILE%" 2>&1"

set "READY=0"
for /l %%N in (1,1,25) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$r=Invoke-WebRequest 'http://127.0.0.1:8787/api/agent' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}" >nul 2>nul
  if not errorlevel 1 (
    set "READY=1"
    goto :ready
  )
  timeout /t 1 /nobreak >nul
)

:ready
if "%READY%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'; $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'; $extra = @('--disable-pinch','--overscroll-history-navigation=0','--disable-features=TouchpadOverscrollHistoryNavigation,TranslateUI','--no-first-run','--no-default-browser-check','--disable-infobars','--disable-session-crashed-bubble','--disable-background-networking','--disable-component-update'); if (Test-Path $edge) { Start-Process -FilePath $edge -ArgumentList (@('--new-window','--kiosk','http://127.0.0.1:8787/','--edge-kiosk-type=fullscreen') + $extra) } elseif (Test-Path $chrome) { Start-Process -FilePath $chrome -ArgumentList (@('--new-window','--kiosk','http://127.0.0.1:8787/') + $extra) } else { Start-Process 'http://127.0.0.1:8787/' }"
  exit /b 0
)

echo Server did not start in time>>"%LOGFILE%"
echo Auto-start failed. Open server-launch.log in the app folder.
pause
exit /b 1