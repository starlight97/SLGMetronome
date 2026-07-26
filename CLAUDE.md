# SLGMetronome (개인용 드럼 메트로놈 PWA)

Unity C# 클라이언트 개발자(웹 프론트 초심자)가 개인용으로 쓰는 드럼 메트로놈.
대상: Windows PC + 갤럭시 폰 + 레노버 패드(Android Chrome). HTTPS 정적 호스팅에 올려 PWA로 설치해서 사용.

## 파일 구조

- `index.html` — 앱 전체. HTML+CSS+JS 단일 파일 (UI/오디오/상태 전부 여기)
- `sw.js` — 서비스 워커. 오프라인 캐시(stale-while-revalidate)
- `manifest.webmanifest` — PWA 설치 매니페스트
- `icon-192.png` / `icon-512.png` / `icon-maskable-512.png` — 앱 아이콘
- `make_icons.py` — 아이콘 재생성 스크립트 (Pillow 필요)
- `test-metronome.mjs` — Playwright 자동 검증 (타이밍 정확도 + 기능 16개 체크 + 스크린샷)

## 절대 깨면 안 되는 것 (오디오 코어)

1. **타이밍 방식**: Web Worker 틱(25ms) + AudioContext 시계 기준 룩어헤드(0.18s) 스케줄링.
   클릭 소리는 `AudioBufferSourceNode.start(절대시각)`으로 예약된다. 이 구조 덕에 지터가 0이다.
   setTimeout/setInterval 시점에 직접 소리를 재생하는 방식으로 바꾸는 것 금지.
2. **백그라운드 재생 라우팅**: master gain → `MediaStreamAudioDestinationNode` → `<audio id="audio-out">`.
   이 경로 때문에 브라우저가 "미디어 재생"으로 취급해 앱을 백그라운드로 내려도 소리가 유지되고
   미디어 알림이 뜬다. `audioEl.play()` 실패 시 `ctx.destination` 직결 폴백(`routed` 변수). 제거/우회 금지.
3. **재동기화 가드**: 스케줄러의 `nextTime < now - 0.12 → 리셋`은 탭 동결 복귀 시 클릭 연타 방지용. 유지.
4. **저장소 접근**: localStorage는 반드시 `store` 래퍼를 통해서만 (미지원 환경에서 메모리 폴백).
5. `window.__dm` 디버그 훅은 테스트가 사용한다. 유지.

## 컨벤션

- 단일 파일 유지: CSS/JS는 index.html 안에 인라인 (sw.js/manifest 제외). 빌드 도구 도입하지 않는다.
- UI 텍스트는 한/영 지원: 모든 문구는 index.html의 `I18N` 딕셔너리에 ko/en 쌍으로 추가하고 `T()`로 조회.
  정적 요소는 `data-i18n` 속성 + `applyLang()`. 기본 언어는 브라우저 언어 자동 감지(`state.lang`), 하단 카드에서 전환.
- 다크 테마. 색은 `:root` CSS 변수(`--bg`, `--card`, `--amber` 등)만 사용.
- 터치 타겟 최소 36px. PC 키보드 단축키(Space, ↑↓←→, T) 유지.
- 상태는 `state` 객체 하나로 관리하고 변경 시 `persist()` 호출. 새 설정 항목은 `restore()`에도 추가.

## 검증

수정 후 `node test-metronome.mjs` 실행 — 16개 체크 전부 PASS여야 하고,
`shot-phone.png`(390×844) / `shot-desktop.png`(1280×800) 스크린샷으로 레이아웃 확인.

최초 1회 준비: `npm init -y && npm i -D playwright && npx playwright install chromium`

## 배포 / 업데이트

- GitHub Pages 등 HTTPS 정적 호스팅에 폴더 그대로 업로드 (빌드 과정 없음).
- 설치: Android Chrome 메뉴 → "앱 설치" (홈 화면에 추가), PC Chrome/Edge 주소창 설치 아이콘.
- 캐시가 stale-while-revalidate라 배포 후 변경은 **재방문 2회차**에 반영됨.
  즉시 강제 반영이 필요하면 `sw.js`의 `CACHE` 버전 문자열을 올릴 것.
