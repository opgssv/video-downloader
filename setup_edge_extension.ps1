# Edge Extension Allowlist 자동 등록 스크립트
# Extension ID: bnndfabkeogfoblpmblnanccaicjnalm

$registryPath = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist"
$extensionId = "bnndfabkeogfoblpmblnanccaicjnalm"

# 1. 관리자 권한 체크
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "오류: 이 스크립트는 관리자 권한으로 실행해야 합니다." -ForegroundColor Red
    exit
}

# 2. 레지스트리 경로가 없으면 생성
if (-not (Test-Path $registryPath)) {
    New-Item -Path $registryPath -Force | Out-Null
    Write-Host "레지스트리 경로 생성 완료: $registryPath" -ForegroundColor Green
}

# 3. 이미 등록되어 있는지 확인
$values = Get-ItemProperty -Path $registryPath
$isAlreadyRegistered = $false
foreach ($name in $values.PSObject.Properties.Name) {
    if ($values.$name -eq $extensionId) {
        $isAlreadyRegistered = $true
        break
    }
}

# 4. 등록 (비어있는 가장 낮은 숫자 이름으로 등록)
if (-not $isAlreadyRegistered) {
    $i = 1
    while ($null -ne (Get-ItemProperty -Path $registryPath -Name "$i" -ErrorAction SilentlyContinue)) {
        $i++
    }
    New-ItemProperty -Path $registryPath -Name "$i" -Value $extensionId -PropertyType String -Force | Out-Null
    Write-Host "확장 프로그램 ID 등록 완료 ($i): $extensionId" -ForegroundColor Green
} else {
    Write-Host "이미 등록되어 있는 ID입니다: $extensionId" -ForegroundColor Yellow
}

Write-Host "`n작업이 완료되었습니다. Edge 브라우저를 재시작하세요." -ForegroundColor Cyan
pause
