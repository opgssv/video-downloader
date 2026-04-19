@echo off
setlocal
title Edge Extension Auto-Registration

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
echo >>> Edge 확장 프로그램 권한 등록을 시작합니다...

:: 2. PowerShell 명령을 통한 레지스트리 작업 (안전한 인덱싱 포함)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$registryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist'; ^
    $extensionId = 'bnndfabkeogfoblpmblnanccaicjnalm'; ^
    if (-not (Test-Path $registryPath)) { New-Item -Path $registryPath -Force | Out-Null }; ^
    $values = Get-ItemProperty -Path $registryPath; ^
    $isAlreadyRegistered = $false; ^
    foreach ($name in $values.PSObject.Properties.Name) { if ($values.$name -eq $extensionId) { $isAlreadyRegistered = $true; break } }; ^
    if (-not $isAlreadyRegistered) { ^
        $i = 1; while ($null -ne (Get-ItemProperty -Path $registryPath -Name \"$i\" -ErrorAction SilentlyContinue)) { $i++ }; ^
        New-ItemProperty -Path $registryPath -Name \"$i\" -Value $extensionId -PropertyType String -Force | Out-Null; ^
        Write-Host '>>> 성공: 확장 프로그램 ID가 허용 목록에 등록되었습니다.' -ForegroundColor Green; ^
    } else { ^
        Write-Host '>>> 정보: 이미 등록되어 있는 ID입니다.' -ForegroundColor Yellow; ^
    }; ^
    Write-Host ' ' ; ^
    Write-Host '작업이 완료되었습니다. Edge 브라우저를 재시작하세요.' -ForegroundColor Cyan"

echo.
echo Press any key to exit...
pause >nul
exit /b
