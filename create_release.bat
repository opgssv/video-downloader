@echo off
setlocal enabledelayedexpansion
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
set "VERSION=1.0.0"
set "RELEASE_NAME=VideoDownloader_Full_Package_v%VERSION%"
set "DIST_FOLDER=release_temp"
set "ZIP_FILE_NAME=%RELEASE_NAME%.zip"
set "BIN_DIR=bin"

powershell -NoProfile -Command "Write-Host '>>> [STEP 1] 필수 엔진(yt-dlp, ffmpeg) 준비 작업 시작...' -ForegroundColor Cyan"

:: 1-1. bin 폴더 생성
if not exist "%BIN_DIR%" (
    mkdir "%BIN_DIR%"
    echo >>> bin 폴더를 생성했습니다.
)

:: 1-2. yt-dlp.exe 찾기 및 복사
if not exist "%BIN_DIR%\yt-dlp.exe" (
    set "WINGET_YTDLP=C:\Users\opgss\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe"
    if exist "!WINGET_YTDLP!" (
        copy "!WINGET_YTDLP!" "%BIN_DIR%\yt-dlp.exe" >nul
        powershell -NoProfile -Command "Write-Host '>>> 시스템에서 yt-dlp.exe를 찾아 bin 폴더로 복사했습니다.' -ForegroundColor Green"
    ) else (
        powershell -NoProfile -Command "Write-Host '!!! 경고: yt-dlp.exe를 찾을 수 없습니다. bin 폴더에 직접 넣어주세요.' -ForegroundColor Red"
    )
)

:: 1-3. ffmpeg.exe 확인
if not exist "%BIN_DIR%\ffmpeg.exe" (
    powershell -NoProfile -Command "Write-Host '!!! 경고: bin 폴더에 ffmpeg.exe가 없습니다. 병합 기능이 작동하지 않을 수 있습니다.' -ForegroundColor Yellow"
)

powershell -NoProfile -Command "Write-Host '`n>>> [STEP 2] Electron Forge 빌드(npm run make) 시작... (수 분 정도 소요될 수 있습니다)' -ForegroundColor Cyan"

:: 2. 빌드 실행
call npm run make
if %errorLevel% neq 0 (
    powershell -NoProfile -Command "Write-Host '`n!!! 빌드 실패: npm run make 도중 오류가 발생했습니다.' -ForegroundColor Red"
    pause
    exit /b %errorLevel%
)

powershell -NoProfile -Command "Write-Host '`n>>> [STEP 3] 배포 패키징 및 압축 시작...' -ForegroundColor Cyan"

:: 3-1. 이전 작업물 정리
if exist "%DIST_FOLDER%" rd /s /q "%DIST_FOLDER%"
if exist "%ZIP_FILE_NAME%" del /f /q "%ZIP_FILE_NAME%"

:: 3-2. 배포 폴더 구성
mkdir "%DIST_FOLDER%"
mkdir "%DIST_FOLDER%\Extension"
mkdir "%DIST_FOLDER%\Scripts"

:: 3-3. 파일 복사
set "SETUP_PATH=out\make\squirrel.windows\x64\video-downloader-app-1.0.0 Setup.exe"
if exist "%SETUP_PATH%" (
    copy "%SETUP_PATH%" "%DIST_FOLDER%\VideoDownloader_Setup.exe" >nul
)

:: 브라우저 확장 프로그램
if exist "extension_dist.zip" (
    copy "extension_dist.zip" "%DIST_FOLDER%\Extension\" >nul
) else if exist "edge-extension" (
    xcopy "edge-extension\*" "%DIST_FOLDER%\Extension\" /e /i /y >nul
)

:: 레지스트리 설정 스크립트 및 문서 (bat 파일 위주로 배포)
copy "setup_edge_extension.bat" "%DIST_FOLDER%\Scripts\" >nul
copy "setup_edge_extension.reg" "%DIST_FOLDER%\Scripts\" >nul
copy "README.md" "%DIST_FOLDER%\README.md" >nul

:: 4. 최종 압축 (PowerShell의 Compress-Archive 사용)
powershell -NoProfile -Command "Compress-Archive -Path '%DIST_FOLDER%\*' -DestinationPath '%ZIP_FILE_NAME%' -Force"

:: 5. 정리
rd /s /q "%DIST_FOLDER%"

echo.
powershell -NoProfile -Command "Write-Host '>>> 모든 작업이 완료되었습니다! 🚀' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host '최종 배포 파일: %ZIP_FILE_NAME%' -ForegroundColor White"

pause
exit /b
