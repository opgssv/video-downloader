@echo off
setlocal enabledelayedexpansion
title Edge Extension Auto-Registration (Force Install)

REM 1. Admin Check
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

pushd "%~dp0"

REM 2. Convert backslashes to forward slashes for file URLs
set "BASE_DIR=%~dp0"
set "BASE_DIR_URL=!BASE_DIR:\=/!"

REM 3. Generate update.xml dynamically with the package ID and absolute path
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
set "REGKEY_FORCE=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForceList"
set "REGKEY_ALLOW=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist"
set "EXTID=klgmfkmpldegiplnkkgfhnakgelmolnm"
set "PROXY_URL=file:///!BASE_DIR_URL!edge-extension/update.xml"
set "REGDATA=!EXTID!;!PROXY_URL!"

REM Clean legacy Allowlist keys if they exist to prevent conflicts
reg delete "%REGKEY_ALLOW%" /f >nul 2>&1

echo Registering Extension to HKLM policies...

REM Find the first empty slot or check if already registered
set SLOT=1
:LOOP
reg query "%REGKEY_FORCE%" /v "%SLOT%" >nul 2>&1
if %errorLevel% neq 0 (
    reg add "%REGKEY_FORCE%" /v "%SLOT%" /t REG_SZ /d "%REGDATA%" /f
    echo [SUCCESS] Registered to Policies in slot %SLOT%.
    goto :DONE
)

REM Verify if this slot already contains the target data
for /f "tokens=2*" %%a in ('reg query "%REGKEY_FORCE%" /v "%SLOT%" 2^>nul') do (
    set "RAW_VAL=%%b"
    REM If the registry query matches the target string
    if "!RAW_VAL!"=="!REGDATA!" (
        echo [INFO] Already registered in slot %SLOT%.
        goto :DONE
    )
)

set /a SLOT=%SLOT%+1
if %SLOT% gtr 50 (
    echo [ERROR] No empty slots found in Registry.
    goto :DONE
)
goto :LOOP

:DONE
echo.
echo Process complete. Please restart Microsoft Edge browser.
echo Press any key to exit...
pause >nul
popd
exit /b
