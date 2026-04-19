@echo off
setlocal
title Video Downloader Release Builder

:: 1. 관리자 권한 확인 및 요청
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :run
) else (
    echo 관리자 권한으로 다시 실행 중...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:run
pushd "%~dp0"
echo >>> [BUILD] 통합 빌드 및 배포 패키징을 시작합니다...

:: 2. 기존 PS1 스크립트 실행 (모든 복잡한 로직 위임)
powershell -NoProfile -ExecutionPolicy Bypass -File "create_release.ps1"

echo.
if %errorLevel% == 0 (
    echo >>> [SUCCESS] 모든 작업이 성공적으로 완료되었습니다.
) else (
    echo >>> [ERROR] 작업 도중 오류가 발생했습니다.
)

pause
exit /b
