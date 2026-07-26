@echo off
setlocal enabledelayedexpansion
title Edge Extension Auto-Registration (Force Install)

REM 1. Self-Elevation to Admin (Always run as Admin)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Requesting Admin Privileges...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

pushd "%~dp0"

REM 2. Convert backslashes to forward slashes for file URLs
set "BASE_DIR=%~dp0"
set "BASE_DIR_URL=!BASE_DIR:\=/!"
set "DRIVE_LETTER=!BASE_DIR:~0,2!"

REM 3. Generate update.xml dynamically inside the edge-extension folder pointing to local crx path
set "XML_PATH=edge-extension\update.xml"
echo Creating update.xml...
(
echo ^<?xml version='1.0' encoding='utf-8'?^>
echo ^<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'^>
echo   ^<app appid='klgmfkmpldegiplnkkgfhnakgelmolnm'^>
echo     ^<updatecheck codebase='file:///!BASE_DIR_URL!edge-extension.crx' version='1.0.0' /^>
echo   ^</app^>
echo ^</gupdate^>
) > "%XML_PATH%"

REM 4. Setup Registry Policies for Extension Force Installation
set "REGKEY_EDGE=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge"
set "REGKEY_FORCE=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
set "REGKEY_SOURCES=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources"
set "EXTID=klgmfkmpldegiplnkkgfhnakgelmolnm"
set "PROXY_URL=file:///!BASE_DIR_URL!edge-extension/update.xml"
set "REGDATA=!EXTID!;!PROXY_URL!"

REM Clean the entire HKLM\...\Edge parent key to fully reset Windows registry's case-preserving cache
echo Resetting Registry policy cache...
reg delete "%REGKEY_EDGE%" /f >nul 2>&1

echo Registering Extension to HKLM Forcelist policies...

REM A. Force Install Registry Add (Corrected Key name: ExtensionInstallForcelist)
set SLOT=1
:LOOP_FORCE
reg query "%REGKEY_FORCE%" /v "%SLOT%" >nul 2>&1
if %errorLevel% neq 0 (
    reg add "%REGKEY_FORCE%" /v "%SLOT%" /t REG_SZ /d "%REGDATA%" /f
    echo [SUCCESS] Registered to Policies in slot %SLOT%.
    goto :ADD_SOURCES
)

for /f "tokens=2*" %%a in ('reg query "%REGKEY_FORCE%" /v "%SLOT%" 2^>nul') do (
    set "RAW_VAL=%%b"
    if "!RAW_VAL!"=="!REGDATA!" (
        echo [INFO] Already registered in slot %SLOT%.
        goto :ADD_SOURCES
    )
)

set /a SLOT=%SLOT%+1
if %SLOT% gtr 50 (
    echo [ERROR] No empty slots found in Registry for Forcelist.
    goto :ADD_SOURCES
)
goto :LOOP_FORCE


:ADD_SOURCES
echo Registering trusted local file sources to prevent 'Not from known source' block...
REM B. Trust Local File Sources (ExtensionInstallSources)
reg add "%REGKEY_SOURCES%" /v "1" /t REG_SZ /d "file://*" /f >nul 2>&1
reg add "%REGKEY_SOURCES%" /v "2" /t REG_SZ /d "file:///*" /f >nul 2>&1
reg add "%REGKEY_SOURCES%" /v "3" /t REG_SZ /d "file:///!DRIVE_LETTER!/*" /f >nul 2>&1
echo [SUCCESS] Trusted local sources registered (file://*, file:///*, file:///!DRIVE_LETTER!/*).
goto :DONE


:DONE
echo.
echo Process complete. Please restart Microsoft Edge browser.
echo Press any key to exit...
pause >nul
popd
exit /b
