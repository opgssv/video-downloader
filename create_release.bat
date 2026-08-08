@echo off
setlocal enabledelayedexpansion
title Video Downloader Release Builder

REM 1. Admin Check
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

pushd "%~dp0"
set "VERSION=1.0.0"
set "REL_NAME=VideoDownloader_Full_Package_v%VERSION%"
set "DIST=release_temp"
set "ZIP=%REL_NAME%.zip"

echo [STEP 1] Checking requirements...
if not exist "bin" mkdir "bin"
if not exist "bin\yt-dlp.exe" (
    set "W_YTDLP=C:\Users\opgss\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe"
    if exist "!W_YTDLP!" (
        copy "!W_YTDLP!" "bin\yt-dlp.exe" >nul
        echo yt-dlp.exe copied to bin folder.
    ) else (
        echo [WARNING] yt-dlp.exe not found. Please add it to bin folder manually.
    )
)

echo.
echo [STEP 2] Starting Electron Forge build...
call npm run make
if %errorLevel% neq 0 (
    echo [FAILURE] npm run make failed.
    pause & exit /b
)

echo.
echo [STEP 3] Packaging and Compressing...
if exist "%DIST%" rd /s /q "%DIST%"
if exist "%ZIP%" del /f /q "%ZIP%"

mkdir "%DIST%"
mkdir "%DIST%\Extension"

set "SETUP_PATH=out\make\squirrel.windows\x64\video-downloader-app-1.0.0 Setup.exe"
if exist "%SETUP_PATH%" (
    copy "%SETUP_PATH%" "%DIST%\VideoDownloader_Setup.exe" >nul
) else (
    echo [WARNING] Setup.exe not found.
)

if exist "extension_dist.zip" (
    copy "extension_dist.zip" "%DIST%\Extension\" >nul
) else if exist "edge-extension" (
    xcopy "edge-extension\*" "%DIST%\Extension\" /e /i /y >nul
)
copy "README.md" "%DIST%\README.md" >nul

echo Creating ZIP archive...
powershell.exe -NoProfile -Command "Compress-Archive -Path '%DIST%\*' -DestinationPath '%ZIP%' -Force"

rd /s /q "%DIST%"
echo.
echo [SUCCESS] Release package created: %ZIP%
echo Press any key to exit...
pause >nul
exit /b
