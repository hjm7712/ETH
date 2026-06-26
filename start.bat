@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ETH WATCH

echo ============================================
echo            ETH WATCH  -  start
echo ============================================
echo.

REM ===== 1) Node.js 확인 -> 없으면 자동 설치 =====
where node >nul 2>nul
if not errorlevel 1 goto NODE_OK

echo [SETUP] Node.js가 설치되어 있지 않습니다. 자동 설치를 시도합니다...
echo.

where winget >nul 2>nul
if not errorlevel 1 (
  echo [SETUP] winget 으로 Node.js LTS 설치 중입니다.
  echo         관리자 권한 승인창이 뜨면 "예" 를 눌러주세요...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
) else (
  echo [SETUP] winget 이 없어 공식 설치파일을 내려받아 설치합니다...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi -OutFile \"%TEMP%\node-lts.msi\""
  echo [SETUP] 설치 중... (설치 창이 뜨면 진행해 주세요)
  msiexec /i "%TEMP%\node-lts.msi" /qn
)

REM 방금 설치한 Node 경로를 이 창의 PATH 에 추가
set "PATH=%PATH%;C:\Program Files\nodejs"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [INFO] 설치는 끝났지만 이 창이 아직 Node 를 인식하지 못합니다.
  echo        이 창을 닫고 start.bat 을 "다시 더블클릭" 하면 정상 작동합니다.
  echo.
  pause
  exit /b 0
)
echo [SETUP] Node.js 설치 완료!
echo.

:NODE_OK

REM ===== 2) 처음 실행이면 패키지 설치 =====
if not exist "node_modules" (
  echo [SETUP] 처음 실행입니다. 필요한 패키지를 설치합니다. 1~2분 소요...
  echo.
  call npm install
  if errorlevel 1 (
    echo [ERROR] 설치 실패 - 인터넷 연결을 확인하세요.
    pause
    exit /b 1
  )
)

REM ===== 3) 5초 뒤 브라우저 자동 오픈 =====
echo.
echo [RUN] 서버를 시작합니다. 5초 후 브라우저가 자동으로 열립니다.
echo       종료: 이 창에서 Ctrl+C 또는 창 닫기
echo.
start "" /b cmd /c "ping -n 6 127.0.0.1 >nul & explorer http://localhost:3000"

REM ===== 4) 개발 서버 실행 =====
npm run dev

pause
