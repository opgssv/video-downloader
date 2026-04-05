# Video Downloader 통합 빌드 및 배포 패키징 스크립트
$version = "1.0.0"
$releaseName = "VideoDownloader_Full_Package_v$version"
$distFolder = "release_temp"
$zipFileName = "$releaseName.zip"
$binDir = "bin"

Write-Host "`n>>> [STEP 1] 필수 엔진(yt-dlp, ffmpeg) 준비 작업 시작..." -ForegroundColor Cyan

# 1-1. bin 폴더 생성
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir | Out-Null
    Write-Host ">>> bin 폴더를 생성했습니다." -ForegroundColor Gray
}

# 1-2. yt-dlp.exe 찾기 및 복사 (절대 경로에서 자동 추출 시도)
$ytdlpTarget = "$binDir\yt-dlp.exe"
if (-not (Test-Path $ytdlpTarget)) {
    $wingetPath = "C:\Users\opgss\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe"
    if (Test-Path $wingetPath) {
        Copy-Item -Path $wingetPath -Destination $ytdlpTarget
        Write-Host ">>> 시스템에서 yt-dlp.exe를 찾아 bin 폴더로 복사했습니다." -ForegroundColor Green
    } else {
        Write-Host "!!! 경고: yt-dlp.exe를 찾을 수 없습니다. bin 폴더에 직접 넣어주세요." -ForegroundColor Red
    }
}

# 1-3. ffmpeg.exe 확인
if (-not (Test-Path "$binDir\ffmpeg.exe")) {
    Write-Host "!!! 경고: bin 폴더에 ffmpeg.exe가 없습니다. 병합 기능이 작동하지 않을 수 있습니다." -ForegroundColor Yellow
}

Write-Host "`n>>> [STEP 2] Electron Forge 빌드(npm run make) 시작... (수 분 정도 소요될 수 있습니다)" -ForegroundColor Cyan

# 2. 빌드 실행 (npm run make)
npm run make
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n!!! 빌드 실패: npm run make 도중 오류가 발생했습니다." -ForegroundColor Red
    pause
    exit
}

Write-Host "`n>>> [STEP 3] 배포 패키징 및 압축 시작..." -ForegroundColor Cyan

# 3-1. 이전 작업물 정리
if (Test-Path $distFolder) { Remove-Item -Path $distFolder -Recurse -Force }
if (Test-Path $zipFileName) { Remove-Item -Path $zipFileName -Force }

# 3-2. 배포 폴더 구성
New-Item -ItemType Directory -Path "$distFolder" | Out-Null
New-Item -ItemType Directory -Path "$distFolder\Extension" | Out-Null
New-Item -ItemType Directory -Path "$distFolder\Scripts" | Out-Null

# 3-3. 파일 복사
$setupPath = "out\make\squirrel.windows\x64\video-downloader-app-1.0.0 Setup.exe"
if (Test-Path $setupPath) {
    Copy-Item -Path $setupPath -Destination "$distFolder\VideoDownloader_Setup.exe"
}

# 브라우저 확장 프로그램
if (Test-Path "extension_dist.zip") {
    Copy-Item -Path "extension_dist.zip" -Destination "$distFolder\Extension\"
} elseif (Test-Path "edge-extension") {
    Copy-Item -Path "edge-extension\*" -Destination "$distFolder\Extension\" -Recurse
}

# 레지스트리 설정 스크립트 및 문서
Copy-Item -Path "setup_edge_extension.ps1" -Destination "$distFolder\Scripts\"
Copy-Item -Path "setup_edge_extension.reg" -Destination "$distFolder\Scripts\"
Copy-Item -Path "README.md" -Destination "$distFolder\README.md"

# 4. 최종 압축
Compress-Archive -Path "$distFolder\*" -DestinationPath $zipFileName -Force
Remove-Item -Path $distFolder -Recurse -Force

Write-Host "`n>>> 모든 작업이 완료되었습니다! 🚀" -ForegroundColor Green
Write-Host "최종 배포 파일: $zipFileName" -ForegroundColor White
pause
