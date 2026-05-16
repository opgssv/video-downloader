@echo off
setlocal
title Edge Extension Auto-Registration

REM 1. Admin Check
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

pushd "%~dp0"
echo Registering Edge Extension...

set "REGKEY=HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist"
set "EXTID=bnndfabkeogfoblpmblnanccaicjnalm"

REM 2. Check duplicate
reg query "%REGKEY%" /f "%EXTID%" /d >nul 2>&1
if %errorLevel% equ 0 (
    echo [INFO] Already registered.
    goto :DONE
)

REM 3. Add to first empty slot
set SLOT=1
:LOOP
reg query "%REGKEY%" /v "%SLOT%" >nul 2>&1
if %errorLevel% neq 0 (
    reg add "%REGKEY%" /v "%SLOT%" /t REG_SZ /d "%EXTID%" /f
    echo [SUCCESS] Registered in slot %SLOT%.
    goto :DONE
)
set /a SLOT=%SLOT%+1
if %SLOT% gtr 20 (
    echo [ERROR] No empty slots found.
    goto :DONE
)
goto :LOOP

:DONE
echo.
echo Process complete. Please restart Edge browser.
echo Press any key to exit...
pause >nul
exit /b
