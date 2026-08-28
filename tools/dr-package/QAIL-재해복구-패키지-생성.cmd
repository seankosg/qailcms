@echo off
REM QAIL CMS 재해복구 패키지 생성기 (Windows)
REM 배포 ZIP 안에서는 run.bundle.mjs, 저장소 안에서는 run.mjs 를 호출합니다.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [실패] Node.js 를 찾지 못했습니다.
  echo   https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

set "ENTRY=%~dp0run.bundle.mjs"
if not exist "%ENTRY%" set "ENTRY=%~dp0run.mjs"

node "%ENTRY%"
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
