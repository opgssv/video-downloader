# Video Downloader System

브라우저 확장(Edge Extension)에서 동영상을 탐지하고, Electron 데스크톱 앱으로 전송하여 고속으로 다운로드하는 하이브리드 비디오 다운로더입니다.

## 🚀 주요 기능

-   **고속 병렬 다운로드**: IDM과 유사한 방식으로 조각들을 병렬로 받아 속도를 극대화 (최대 5개 동시 연결).
-   **스마트 파일명**: 브라우저 탭의 제목을 자동으로 추출하여 파일명으로 지정합니다.
-   **자동 앱 실행**: 확장에서 주소를 클릭하면 앱이 꺼져 있어도 자동으로 실행됩니다.
-   **강력한 탐지 (Sniffing)**: `.m3u8`, `.mp4`, `.mpd`, YouTube 스트림 등 다양한 형식을 자동으로 감지합니다.
-   **백그라운드 유지**: 앱을 최소화하거나 다른 창에 가려져도 속도 저하 없이 다운로드가 지속됩니다.
-   **차단 사이트 우회 보조**: SNI 차단 환경에서도 브라우저가 잡아낸 주소를 활용해 분석 실패 없이 다운로드 가능합니다.

---

## 🛠️ 설치 및 사용 방법

### 1. 데스크톱 앱 (Electron)
1.  `video-downloader-app-1.0.0 Setup.exe` 파일을 실행하여 앱을 설치합니다.
2.  앱이 실행되면 다운로드 경로를 설정하고 "Use Edge Cookies" 옵션을 확인합니다.

### 2. 브라우저 확장 프로그램 (Edge)
1.  Edge 브라우저에서 `edge://extensions` 주소로 이동합니다.
2.  왼쪽 하단의 **[개발자 모드]**를 활성화합니다.
3.  **[압축 해제된 확장 로드]** 버튼을 누르고 프로젝트의 `edge-extension` 폴더를 선택하거나, 배포된 폴더를 선택합니다.

#### 💡 Edge 확장 권한 자동 등록 (Edge 재시작 시 초기화 방지)
Edge 브라우저 정책에 따라 확장이 매번 비활성화되는 경우, 다음 도구를 사용하여 확장 ID를 허용 목록에 등록하세요.
-   **PowerShell**: `setup_edge_extension.ps1` 파일을 **관리자 권한**으로 실행합니다.
-   **Registry**: `setup_edge_extension.reg` 파일을 실행하여 레지스트리에 병합합니다. (관리자 권한 필요)

### 3. 동영상 다운로드
-   **일반 사이트**: 페이지 이동 후 확장 아이콘을 누르고 **[Send Current Page URL]** 클릭.
-   **YouTube/Twitter**: 영상을 재생한 상태에서 **[Send Current Page URL]** 클릭.
-   **차단/특수 사이트**: 영상을 재생하면 하단 **[Detected Video URLs]** 목록에 주소가 나타납니다. 원하는 주소(`.m3u8` 등)를 클릭하세요.

---

## 📝 문제 해결 (Troubleshooting)

-   **"Error launching app"**: 앱이 한 번도 실행되지 않았을 때 발생할 수 있습니다. 앱을 관리자 권한으로 실행하거나 `Setup.exe`를 통해 재설치하세요.
-   **다운로드 실패 (403/404)**: 링크가 만료된 경우입니다. 브라우저 페이지를 **새로고침(F5)** 한 뒤 영상을 다시 재생하고 새 주소를 클릭하세요.
-   **속도 저하**: 네트워크 환경을 확인하고, 백신 프로그램이 `yt-dlp`를 검사하고 있지 않은지 확인하세요.

---

## 💻 개발자 정보
-   **Framework**: Electron, React, TypeScript, Webpack
-   **Engine**: yt-dlp (Latest), ffmpeg
-   **Communication**: Custom Protocol (`video-downloader://`), Local HTTP Server (Port 8888)
