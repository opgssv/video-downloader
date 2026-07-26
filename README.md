# 🚀 Video Downloader System

브라우저 확장(Edge Extension)에서 동영상을 탐지하고, Electron 데스크톱 앱으로 전송하여 고속으로 다운로드하는 하이브리드 비디오 다운로더입니다.

---

## ✨ 주요 기능

-   **고속 병렬 다운로드**: 조각들을 병렬로 받아 속도를 극대화합니다 (IDM 스타일).
-   **파일명 커스터마이징**: 다운로드 전 파일명을 자유롭게 수정할 수 있습니다.
-   **스마트 큐 관리**:
    -   **자동 삭제**: 다운로드 완료 시 목록에서 자동 제거 옵션 제공.
    -   **자동 종료**: 모든 작업 완료 시 프로그램 자동 종료 옵션 제공.
-   **상태 유지**: 마지막 창 크기, 다운로드 경로, 자동화 설정이 세션 간에 유지됩니다.
-   **강력한 엔진**: 최신 `yt-dlp` 및 `ffmpeg`를 내장하여 복잡한 스트리밍 영상도 완벽하게 병합합니다.

---

## 🛠️ 설치 및 설정

### 1. 데스크톱 앱 실행
1. `VideoDownloader_Setup.exe`를 실행하여 앱을 설치합니다.
2. 앱 실행 후 **[Change]** 버튼을 눌러 영상이 저장될 폴더를 지정하세요.

### 2. 브라우저 확장 프로그램 (Edge)
개발자 경고 팝업이 뜨지 않도록 브라우저 정책(Registry)을 이용해 패키지 형태로 강제 자동 로드하는 방식입니다.

#### 💡 Edge 확장 자동 등록 및 경고 차단 방법 (필수)
1. Edge 브라우저를 완전히 종료합니다.
2. [setup_edge_extension.bat](file:///D:/gemini/video-downloader-app/setup_edge_extension.bat) 파일을 **더블클릭**하여 실행합니다. (관리자 권한 UAC 창이 뜨면 승인해 줍니다.)
3. Edge 브라우저를 실행하면 **Video App Linker**가 수동 추가 작업 없이 자동으로 활성화됩니다.
   * *주: 이 강제 설치(`Forcelist`) 방식은 보안상 사용자가 브라우저 UI에서 수동으로 On/Off할 수 없으며 상시 ON으로 유지됩니다.*

---

## 📖 사용 방법

1. **동영상 페이지 접속**: Edge 브라우저에서 원하는 동영상을 재생합니다.
2. **확장 프로그램 클릭**: 브라우저 우측 상단의 [Video App Linker] 아이콘을 클릭합니다.
3. **링크 전송**: 탐지된 URL 목록 중 원하는 항목을 클릭하여 앱으로 전송합니다.
4. **파일명 수정 (선택)**: 앱의 **[File Name]** 입력 칸에서 원하는 저장 파일명을 입력합니다.
5. **포맷 선택 및 다운로드**: 원하는 화질(Format)의 **[Download]** 버튼을 클릭합니다.
6. **자동화 옵션**:
    - 목록을 깔끔하게 유지하려면 `Auto-remove completed items`를 체크하세요.
    - 야간 다운로드 시 `Auto-quit when all downloads finish`를 체크하면 완료 후 프로그램이 종료됩니다.

---

## ⚠️ 문제 해결 (Troubleshooting)

### Q1. Edge에서 "알 수 없는 정책입니다" 오류가 나거나 확장이 로드되지 않나요?
* **원인**: 윈도우 레지스트리는 키를 삭제하고 재생성해도 이전에 생성되었던 대소문자 이름 포맷을 기억(Case-preserving cache)하는 버그가 있습니다. 이 때문에 올바른 소문자 `ExtensionInstallForcelist`가 아닌 대문자 `ExtensionInstallForceList`로 남아있을 수 있습니다.
* **해결 방법 (5초 조치)**:
  1. `Win + R`을 누르고 `regedit`을 입력해 레지스트리 편집기를 실행합니다.
  2. `컴퓨터\HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge` 경로로 이동합니다.
  3. 좌측 폴더 트리에서 **`ExtensionInstallForceList`**를 마우스 우클릭 -> **[이름 바꾸기]**를 클릭하여 마지막 `List`를 소문자 `list`로 바꾼 **`ExtensionInstallForcelist`**로 변경해 줍니다.
  4. `edge://policy` 페이지로 이동하여 **[정책 다시 로드]**를 클릭하면 차단이 풀립니다.

### Q2. 확장을 사용자가 필요에 따라 수동으로 On/Off 하거나 제거하고 싶어요.
* **Force 설치 방식의 한계**: 현재 자동 등록 방식(`Forcelist` 정책)은 경고창 팝업이 뜨지 않는 강력한 장점이 있으나, 브라우저 규정상 ON 상태가 강제되어 사용자가 수동으로 끌 수 없습니다.
* **수동 On/Off 전환 방법**:
  1. `Win + R` -> `regedit`을 실행하여 `컴퓨터\HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge` 경로로 이동합니다.
  2. `ExtensionInstallForcelist` 폴더(키)를 마우스 우클릭하여 **삭제**합니다.
  3. `edge://extensions` 설정 페이지로 이동하여 **[개발자 모드]**를 활성화합니다.
  4. **[압축 해제된 확장 로드]** 버튼을 누르고 프로젝트의 `edge-extension` 폴더를 직접 선택하여 로드합니다. (이 방식으로 등록하면 사용자가 자유롭게 On/Off 할 수 있습니다. 단, 브라우저가 실행될 때마다 "개발자 모드 확장 사용 해제" 팝업 경고가 매번 뜨게 됩니다.)

---

## 💻 개발자 및 배포 정보
- **Build**: `create_release.bat` 배치 파일을 실행하여 빌드부터 압축까지 한 번에 완료할 수 있습니다.
- **Dependencies**: `bin/` 폴더 내에 `yt-dlp.exe`와 `ffmpeg.exe`가 반드시 포함되어야 합니다.
