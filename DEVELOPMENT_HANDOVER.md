# 🚀 Video Downloader App - Development Handover & Context State

이 문서는 대화 세션이 만료되거나 새로운 환경에서 개발을 재개할 때, 다음 AI 어시스턴트(또는 개발자)가 프로젝트의 맥락을 즉시 이해하고 이전 작업 내용을 이어서 진행할 수 있도록 작성된 **인수인계 및 기술 명세서**입니다.

---

## 📌 1. 프로젝트 아키텍처 개요
본 애플리케이션은 **Electron 기반 데스크톱 다운로더 앱**과 **Microsoft Edge 브라우저 확장 프로그램(Video App Linker)**이 협력하여 작동하는 하이브리드 구조입니다.

* **확장 프로그램 (Edge Extension)**: 브라우저에서 재생 중인 동영상 스트림(HLS/M3U8 등)을 감지하고, 해당 미디어 주소와 세션 쿠키, 헤더를 데스크톱 앱의 로컬 API 서버로 포워딩합니다.
* **데스크톱 앱 (Electron Main)**: 내장된 `yt-dlp` 및 `ffmpeg` 엔진을 가동하여 전송받은 링크를 병렬 조각으로 다운로드하고 하나로 머지합니다. 내부적으로 우회용 로컬 프록시 서버(`127.0.0.1:8888`)가 가동됩니다.

---

## 🔑 2. 핵심 보안 우회 구현 기술

### 1) surrit.com M3U8 & Segment 403 Forbidden 우회 (로컬 리버스 프록시)
* **문제 상황**: `surrit.com` CDN은 강력한 Cloudflare 안티봇을 사용하여 `yt-dlp`가 세그먼트를 직접 다운로드하려고 하면 TLS 지문 검증을 통해 `403 Forbidden` 에러를 유발하며 무한 멈춤 현상이 발생했습니다.
* **해결 구조**:
  1. 분석/다운로드 요청이 들어오면 우선 `curl.exe`를 사용하여 최초의 M3U8 파일을 다운로드합니다.
  2. 다운로드한 M3U8 파일 내부의 세그먼트 경로를 로컬 프록시 주소인 `http://127.0.0.1:8888/proxy/<encoded-original-segment-url>` 형태로 리라이팅하여 로컬 디스크에 임시 저장합니다.
  3. `yt-dlp`에게는 이 리라이팅된 로컬 M3U8 파일 경로를 넘겨줍니다.
  4. `yt-dlp`가 세그먼트를 요청하면 로컬 서버가 이를 받아 **내부적으로 `curl.exe`를 구동하여 실제 surrit.com 세그먼트를 대리 다운로드**한 후 스트리밍 데이터로 파이핑 피드백합니다.
  * **관련 코드**: [src/index.ts](file:///D:/gemini/video-downloader-app/src/index.ts) 내의 `startLocalServer` (GET `/proxy/*` 라우터) 및 `downloadAndRewriteM3u8` 함수.

### 2) Edge "개발자 모드 확장 사용 해제" 경고창 해제 (Forcelist 사이드로딩)
* **문제 상황**: 폴더 형태로 확장 프로그램을 로드하면 Edge가 켜질 때마다 개발자 모드 경고 팝업이 발생합니다. 반면 정책(`Forcelist`)을 통해 `.crx` 파일을 직접 사이드로딩하면 비도메인(개인용) PC 환경에서 "알려진 출처가 아님"으로 강제 차단되는 딜레마가 있었습니다.
* **해결 구조**:
  1. **고유 ID 잠금**: `edge-extension.pem` 개인 키를 기반으로 Chromium 공개 키 서명을 추출해 [manifest.json](file:///D:/gemini/video-downloader-app/edge-extension/manifest.json) of `"key"` 필드에 박아두었습니다. 이를 통해 언팩이든 패키징이든 ID가 항상 **`klgmfkmpldegiplnkkgfhnakgelmolnm`**으로 영구 고정됩니다.
  2. **삼중 신뢰 필터링 등록**: 비도메인 기기에서 로컬 경로를 무시하지 않도록 `ExtensionInstallSources` 정책에 로컬 드라이브의 삼중 와일드카드 패턴(`file://*`, `file:///*`, `file:///D:/*`)을 주입하여 신뢰할 수 있는 소스로 승격시켰습니다.
  3. **Forcelist 레지스트리 매핑**: `update.xml` 지시 파일을 로컬에 동적으로 구운 뒤 `ExtensionInstallForcelist` 레지스트리에 주입하여 팝업 경고 없이 강제 설치가 작동되도록 조치했습니다.
  * **관련 파일**: [setup_edge_extension.bat](file:///D:/gemini/video-downloader-app/setup_edge_extension.bat) 배치 스크립트.

---

## 🛠️ 3. 윈도우 레지스트리 주의사항 (대소문자 민감도 버그)
정책 적용 시 Edge 엔진이 윈도우 레지스트리 키의 **대소문자**를 극도로 엄격하게 구별합니다.
* **오류 명칭**: `ExtensionInstallForceList` (대문자 `L` 사용 시 Edge 정책 뷰(`edge://policy`)에서 **"알려진 정책이 아닙니다"** 오류가 발생하며 로드가 무시됩니다.)
* **정식 명칭**: **`ExtensionInstallForcelist`** (반드시 소문자 `l`이어야 정상 동작합니다.)
* **윈도우 캐시 버그 해결**: 윈도우 레지스트리에 이미 대문자 버전의 키가 한 번 생성된 적이 있다면 대소문자 보존 캐시(Case-preserving cache)로 인해 배치 파일로 다시 써도 소문자로 갱신되지 않습니다. 이 경우 `regedit`을 열고 `컴퓨터\HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge` 경로 하위에서 직접 수동으로 이름을 소문자 `Forcelist`로 바꾸어 주거나 `Edge` 부모 키를 통째로 삭제한 뒤 배치 파일을 다시 실행해야 정상 복원됩니다.

---

## 📁 4. 형상관리 및 빌드 상태

현재 Git 스테이징(`git add`) 영역에 아래 파일들이 변경 사항으로 반영되어 있습니다:
* [edge-extension/manifest.json](file:///D:/gemini/video-downloader-app/edge-extension/manifest.json): ID 고정을 위한 `"key"` 필드 및 정책 매칭을 위한 `"version": "1.0.0"` 갱신.
* [setup_edge_extension.bat](file:///D:/gemini/video-downloader-app/setup_edge_extension.bat): 캐시 클리어 및 `Forcelist` 대소문자 교정, 로컬 예외 처리 자동화가 보완된 최신 관리자 쉘 스크립트.
* [src/index.ts](file:///D:/gemini/video-downloader-app/src/index.ts): 리버스 프록시 우회용 로컬 서버 구현 본문 유지 및 찌꺼기 라우팅 원복 완료.
* [README.md](file:///D:/gemini/video-downloader-app/README.md): 트러블슈팅 가이드 및 수동/자동 로드 옵션 비교 가이드 문서 추가.

---

## 🚀 5. 다음 단계 개발 가이드 (Next Steps)
다음 세션을 이어받는 AI 모델은 아래 개발 태스크를 순차적으로 고려할 수 있습니다:
1. **Edge 로컬 정책 연동 검증**: 사용자가 레지스트리를 갱신하고 Edge 브라우저를 켰을 때, `edge://extensions`에 **Video App Linker**가 조직 관리 상태로 경고창 없이 무사히 안착되었는지 유저의 피드백을 검증합니다.
2. **패키징 빌드 및 배포 테스트**: 로컬 프록시 코드가 깔끔히 정리되어 반영되었으므로 `npm run package` 또는 `npm run make`를 통해 생성된 최종 바이너리가 릴리즈 폴더에 에러 없이 떨어지는지 테스트하고 검증합니다.
3. **surrit.com 다운로드 테스트**: 프록시 라우터가 정상 작동하는지 surrit.com CDN 주소 동영상을 실제로 받아보며 병합 처리 및 속도가 원활히 나오인지 실테스트합니다.
