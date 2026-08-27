@echo off
REM QAIL CMS 재해복구 패키지 생성기 (Windows)
REM 공용 엔진(run.mjs)을 그대로 호출합니다. OS별 차이는 이 런처와 pg_dump 탐색뿐입니다.
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

node "%~dp0run.mjs"
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
