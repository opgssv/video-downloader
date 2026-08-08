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

REM 2. Support both the development layout and the release layout.
REM    Development: <root>\edge-extension + <root>\edge-extension.crx
REM    Release:     <root>\Extension + <root>\Scripts\setup_edge_extension.bat
set "SCRIPT_DIR=%~dp0"
set "EXT_DIR=%SCRIPT_DIR%edge-extension"
set "CRX_PATH=%SCRIPT_DIR%edge-extension.crx"
if not exist "%EXT_DIR%\manifest.json" (
    set "EXT_DIR=%SCRIPT_DIR%..\Extension"
    set "CRX_PATH=%EXT_DIR%\edge-extension.crx"
)

if not exist "%EXT_DIR%\manifest.json" (
    echo [ERROR] Extension source folder was not found.
    echo Expected: "%EXT_DIR%\manifest.json"
    pause
    exit /b 1
)
if not exist "%CRX_PATH%" (
    echo [ERROR] Extension package was not found.
    echo Expected: "%CRX_PATH%"
    pause
    exit /b 1
)

for /f "tokens=2 delims=:," %%A in ('findstr /r /c:"\"version\"[ ]*:" "%EXT_DIR%\manifest.json"') do set "VERSION=%%~A"
set "VERSION=!VERSION:"=!"
set "VERSION=!VERSION: =!"
set "EXT_DIR_URL=!EXT_DIR:\=/!"
set "CRX_URL=!CRX_PATH:\=/!"
set "DRIVE_LETTER=!CRX_PATH:~0,2!"

REM 3. Generate update.xml next to the extension source, pointing to the actual CRX.
set "XML_PATH=%EXT_DIR%\update.xml"
echo Creating update.xml...
(
echo ^<?xml version='1.0' encoding='utf-8'?^>
echo ^<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'^>
echo   ^<app appid='klgmfkmpldegiplnkkgfhnakgelmolnm'^>
echo     ^<updatecheck codebase='file:///!CRX_URL!' version='!VERSION!' /^>
echo   ^</app^>
echo ^</gupdate^>
) > "%XML_PATH%"

REM 4. Setup Registry Policies for Extension Force Installation
set "REGKEY_EDGE=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge"
set "REGKEY_FORCE=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
set "REGKEY_SOURCES=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources"
set "EXTID=klgmfkmpldegiplnkkgfhnakgelmolnm"
set "PROXY_URL=file:///!EXT_DIR_URL!/update.xml"
set "REGDATA=!EXTID!;!PROXY_URL!"

REM Recreate only this extension's force-install list. Never remove unrelated Edge policies.
echo Resetting this extension's force-install policy...
reg delete "%REGKEY_FORCE%" /f >nul 2>&1

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
