# 📦 Video Downloader 배포 필수 파일 리스트

이 프로그램을 다른 사용자에게 배포하거나 설치할 때 필요한 파일 및 구성 요소 리스트입니다.

## 1. 메인 애플리케이션 (데스크톱 앱)
*   **파일**: `video-downloader-app-1.0.0 Setup.exe`
*   **위치**: `video-downloader-app/out/make/squirrel.windows/x64/`
*   **설명**: 사용자가 실행하여 앱을 설치하는 메인 설치 파일입니다.

## 2. 브라우저 확장 프로그램 (Edge Extension)
*   **파일**: `extension_dist.zip` (또는 `edge-extension/` 폴더 전체)
*   **위치**: `video-downloader-app/`
*   **설명**: Edge 브라우저에 "압축 해제된 확장 로드"로 설치할 확장 프로그램 패키지입니다.

> Edge 정책이나 CRX 패키지는 필요하지 않습니다. 사용자는 `edge://extensions`에서 개발자 모드를 켠 뒤 폴더를 직접 로드합니다.

## 3. 핵심 엔진 (External Dependencies)
현재 코드상에서는 외부 경로를 참조하고 있으나, 배포 시에는 앱 폴더 내에 포함시키는 것이 좋습니다.
*   **yt-dlp.exe**: 동영상 분석 및 다운로드 핵심 엔진.
*   **ffmpeg.exe**: 다운로드된 영상 조각들을 하나로 합치는 병합 엔진.
