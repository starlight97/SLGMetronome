# SLGMetronome — iPadOS 첫 재생 연타음 버그 인수인계 문서

> 작성: 2026-08-02. 이 문서는 다른 AI/개발자가 이 버그를 이어받아 해결할 수 있도록,
> 지금까지의 시도·관찰 사실·현재 코드·외부 기술 자료 조사 결과를 정리한 것이다.
> 함께 제공할 파일: `index.html` (앱 전체가 이 단일 파일에 있음)

---

## 0. 붙여넣을 프롬프트

```
너는 Web Audio API와 iOS Safari/WebKit 내부 동작에 정통한 시니어 웹 오디오 엔지니어다.

첨부한 인수인계 문서(ios-bug-handoff.md)와 소스(index.html)를 읽고,
iPadOS에서 "첫 재생 시 첫 1~2초의 클릭이 연타음(두르르르)으로 뭉개지는" 버그의
원인을 규명하고 수정안을 제시하라.

필수 준수사항:
- 백그라운드 재생 경로(MediaStreamAudioDestinationNode → <audio srcObject>)는 제거하면 안 된다.
  (iPad에서 백그라운드 재생이 실제로 동작함이 확인됐고, 사용자가 이 기능을 원한다)
- Web Worker 틱 + AudioContext 시계 룩어헤드 스케줄링 구조는 유지한다.
- 문서 4장의 이미 실패한 3가지 접근("클록/재생속도 안정화 대기" 계열)을 반복하지 마라.
- 데스크톱에서는 재현되지 않는 버그다. 추측만으로 코드를 바꾸지 말고,
  아이패드 실기기에서 원인을 확정하는 진단 단계를 먼저 제안하라
  (Mac 원격 디버깅 없이 가능한 방법 우선 — 문서 7장에 초안 있음).

참고: 문서 8장에 이 버그와 부합하는 WebKit 공식 버그 리포트들과 선행 사례
(원조 cwilso/metronome의 iPad 클록 동결 이슈 포함), 커뮤니티 표준 우회책이 정리되어 있다.
문서 5장의 가설 H1~H5와 7장의 후보 수정안을 평가 출발점으로 삼되, 얽매이지 마라.

요구 산출물:
1. 가설 H1~H5 평가 + 필요 시 자체 가설 추가
2. 원인을 확정할 진단 코드 (index.html에 바로 넣을 수 있는 형태)
3. 확정된 원인에 대한 수정 코드

먼저 문서를 읽고, 불명확한 점이 있으면 질문부터 하라.
```

---

## 1. 앱 개요 / 환경

- **앱**: 개인용 드럼 메트로놈 PWA. HTML+CSS+JS 단일 파일(`index.html`), 빌드 없음.
- **배포**: GitHub Pages — https://starlight97.github.io/SLGMetronome/ (저장소: github.com/starlight97/SLGMetronome)
- **오디오 아키텍처** (절대 깨면 안 되는 코어):
  - Web Worker가 25ms마다 틱 → `schedulerTick()`이 AudioContext 시계 기준 룩어헤드 0.18s 안의 클릭을
    `AudioBufferSourceNode.start(절대시각)`으로 예약. (Chris Wilson "A Tale of Two Clocks" 패턴)
  - 라우팅: `master gain → MediaStreamAudioDestinationNode → <audio id="audio-out" srcObject>`.
    이 경로 덕에 브라우저가 "미디어 재생"으로 취급 → **백그라운드 재생 유지 + 미디어 알림**.
    `audioEl.play()` 실패 시 `ctx.destination` 직결 폴백(`routed` 변수).
  - AudioContext는 앱 로드 시가 아니라 **재생 버튼을 처음 누른 시점에 생성**됨.
    사전 언락/예열 단계는 현재 없음 (재생 버튼이 곧 첫 제스처 겸 초기화).
- **문제 기기**: iPad (Android 폰/패드, Windows PC에서는 이 버그 없음). iPadOS 버전 미상 — **다음 담당자는 먼저 iPadOS/Safari 버전을 확인할 것** (8장: 버전별 현재진행형 회귀 구간이 존재).
- **자동 테스트**: `node test-metronome.mjs` (Playwright/Chromium, 17개 체크). 단 **이 버그는 데스크톱 Chromium에서 재현되지 않아** 테스트는 회귀 방지용일 뿐, 수정 효과 검증은 아이패드 실기기로만 가능했다.

## 2. 증상 (관찰된 사실만)

1. 아이패드에서 **페이지 로드 후 첫 재생**의 첫 1~2초(약 한 마디)가 "두르르르르" 연타음으로 뭉개진다. 이후 정상.
2. **새로고침할 때마다 재발**. 같은 페이지에서 두 번째 재생(정지 후 재시작)은 정상.
3. 앱을 열고 **5초 기다렸다가 재생해도 동일하게 발생** (오디오 초기화가 재생 버튼 시점이므로 예상과 일치).
4. 아이패드에서 이 앱의 **백그라운드 재생은 정상 동작** (홈으로 나가도 소리 유지 — 사용자 실측).
5. 데스크톱(Chromium/Edge), Android에서는 미발생.

미확인 사항 (다음 담당자가 확인하면 좋은 것):
- **iPadOS 버전** (8장의 버전별 회귀 구간 판별에 필수)
- Safari 탭 vs 홈 화면 설치 PWA(standalone)에서 각각 발생하는지 (iOS 26 계열은 PWA에서만 깨지는 보고 있음)
- **이어폰/블루투스 연결 시 증상이 사라지는지** (샘플레이트 불일치 가설 H5의 결정적 판별 — howler#1141은 내장 스피커에서만 발생했다)
- 연타음의 정확한 길이·클릭 개수 (다른 폰으로 녹음해 파형을 보면: 동일 파형 조각 반복이면 렌더러 글리치, 서로 다른 클릭 N발이 촘촘하면 스케줄/클록 계열)
- 각 수정 버전 테스트 시 헤더의 버전 표기(v9/v10/v11)를 확인하고 테스트했는지
  (v10부터 헤더에 버전이 표시됨. v9 테스트는 표기 도입 전이라 구버전으로 테스트했을 가능성 배제 불가)

## 3. 관련 현재 코드 (v13 기준 발췌)

재생 시작 흐름 (`togglePlay`):

```js
initAudio();                 // 첫 호출 시 AudioContext + MediaStreamAudioDestination + <audio>.srcObject 셋업
state.playing=true;
await ensureRoute();         // ctx.resume() → audioEl.play() (성공 시 routed='media')
if(!warmedUp){await waitForClock();await waitForSteadyClock();}   // ← 시도 1·3의 예열 대기
if(!state.playing)return;
pos={bar:0,beat:0,sub:0};barsSince=0;queue.length=0;
nextTime=ctx.currentTime+(warmedUp?.1:.35);   // 첫 재생만 0.35s 오프셋 (시도 1)
warmedUp=true;
ticker.start();              // 워커 25ms 틱 시작
```

스케줄러 (시도 3의 연타 봉쇄 포함):

```js
function schedulerTick(){
  if(!state.playing||!ctx)return;
  const now=ctx.currentTime;
  if(nextTime<now-.12){                       // 재동기화 가드 (탭 동결 복귀용)
    const w=performance.now(), burst=w-lastResync<400;
    lastResync=w;
    nextTime=now+.05;
    if(burst)return;                          // 400ms 내 연속 발동 시 이번 틱 예약 생략 (시도 3)
  }
  while(nextTime<now+LOOKAHEAD){scheduleNote(nextTime);advance();}   // LOOKAHEAD=0.18
}
```

예열 대기 함수 (시도 1·3):

```js
async function waitForClock(){   // ctx.currentTime이 "흐르기 시작"할 때까지 (최대 0.6s)
  const t0=ctx.currentTime, s=performance.now();
  while(ctx.currentTime===t0&&performance.now()-s<600)await new Promise(r=>setTimeout(r,25));
}
async function waitForSteadyClock(){   // iOS만: 진행 속도가 실시간(0.8~1.2배)으로 2회 연속 안정될 때까지 (최대 3s)
  if(!IS_IOS)return;
  let prevC=ctx.currentTime, prevW=performance.now(), stable=0;
  const s=prevW;
  while(performance.now()-s<3000&&stable<2){
    await new Promise(r=>setTimeout(r,200));
    const c=ctx.currentTime, w=performance.now();
    const rate=(c-prevC)/((w-prevW)/1000);
    prevC=c; prevW=w;
    if(rate>.8&&rate<1.2)stable++;else stable=0;
  }
}
```

기타: `IS_IOS = /iP(hone|ad|od)/.test(UA) || (MacIntel && maxTouchPoints>1)`.
AudioContext는 `new AC({latencyHint:'interactive'})`로 생성 — **sampleRate 명시 없음, ctx.sampleRate를 어디서도 확인하지 않음**.
클릭 버퍼는 `ctx.createBuffer(1, n, ctx.sampleRate)`로 합성(`makeClick`), 클릭마다 새 `AudioBufferSourceNode` 생성.
정지 시 `audioEl.pause()`, 재시작 시 `audioEl.play()` 재호출 — **재시작은 연타음 없음**.

## 4. 실패한 시도 3가지 (반복 금지)

| 버전 | 가설 | 수정 내용 | 결과 |
|---|---|---|---|
| v9 | 오디오 세션이 늦게 열려 첫 클릭들이 밀렸다 몰아 재생됨 | `waitForClock()`(시계가 흐를 때까지 대기) + 첫 클릭 0.35s 오프셋 | **실패** — 증상 그대로 |
| v10 | `<audio>`(MediaStream)가 시작 직후 밀린 구간을 몰아서 재생(따라잡기)하며 클릭을 압축 | `waitForLiveEdge()` — `audioEl.currentTime` 재생 속도가 1배속으로 2회 연속 안정될 때까지 무음 대기(최대 2.5s) | **실패** — 증상 그대로 |
| v11 | `ctx.currentTime`이 resume() 직후 실시간보다 빨리 질주 → 재동기화 가드가 25ms마다 발동해 틱당 1클릭 = 연타 | `waitForSteadyClock()`(시계 진행 속도 실측 대기) + 가드 400ms 내 연속 발동 시 예약 생략 | **실패** — 증상 그대로 |

사후에 확인된 실패 이유 (8장 자료 기준):

- **v10이 원리적으로 무효**: MediaStream을 재생하는 media element의 `currentTime`은 스펙상 그냥 "재생 중 실시간으로 선형 증가"로 정의될 뿐이고(버퍼링/따라잡기 개념 자체가 없음), 브라우저별 구현도 제각각(Chromium은 아예 0에 고정) → 안정화 신호로 쓸 수 없는 값이었다. [w3c spec, web-audio-api#2293]
- **v9·v11 같은 "클록 관찰 대기"류가 무효일 수 있음**: iOS에서 `state==='running'`인데 currentTime이 멈춰 있는 사례(WebKit 263627), resume() promise가 클록 시작 전에 resolve되는 사례(Chromium 41302928)가 공식 확인됨. 또한 렌더 페이스 이상이 JS에서 보는 currentTime 슬로프에 반드시 반영된다는 보장이 없다.
- **v11의 "가드 연속 발동 시 예약 생략" 안전망까지 뚫린 점이 중요한 단서**: 연타음이 "스케줄러가 여러 발 예약해서" 나는 게 아니라, **정상 간격으로 예약된 클릭들이 출력단에서 압축·왜곡되어 나올 가능성** (H4/H5)을 시사한다.

## 5. 가설 정리

- **H1 (기각, v9)**: 오디오 세션 지연으로 첫 클릭들이 몰림 → 예약 지연으로 해결됐어야 하나 실패.
- **H2 (감지 방법만 기각, v10)**: `<audio>` 요소의 출력 시작 글리치. audioEl.currentTime 기반 감지는 원리적으로 무효였음이 확인됐으나(4장), **가설 자체는 유력하게 살아있다** — WebKit은 `<audio srcObject>` 재생 시작 순간 CoreAudio 출력 유닛을 재구성하고(버퍼 100ms→20ms 전환, changeset 292563), media element↔WebAudio 글루가 재생 전환 시점에 딱 한 번만 동기화 값을 계산해 직후 1초+ 글리치가 나는 미해결 버그(221334)도 있다.
- **H3 (부분 기각, v11)**: ctx.currentTime 질주 → 가드 연타. 연타 봉쇄 안전망까지 뚫려 스케줄링 단이 아닐 가능성이 높아졌지만, 클록 질주 자체는 WebKit 공식 버그로 실재했던 병리(232728: 하드웨어 샘플레이트 전환 시 1.84배 질주)라 완전히 배제하긴 이르다.
- **H4 (미검증)**: 출력단 렌더러 글리치/언더런. 첫 재생 직후 하드웨어 재구성 구간에서 WebKit 렌더 파이프라인이 잘못된 페이스로 돌거나 더듬거림 — JS에서 관측 가능한 어떤 시계에도 이상이 안 보일 수 있고, 클릭을 늦게 예약해도 소용없음. v9~v11 전멸과 정합.
- **H5 (미검증, 저비용 판별 가능)**: **샘플레이트 불일치**. 첫 기동 시 AudioContext가 하드웨어와 다른 sampleRate로 생성되면 리샘플링 왜곡/크래클 연속음 발생 — iOS의 유명한 버그 계열(Tone.js#134, howler#1141: 내장 스피커에서만, 리로드마다 재발 여부 달라짐). 이 앱은 sampleRate를 명시하지도 확인하지도 않는다. **이어폰을 꽂으면 증상이 사라지는지 + ctx.sampleRate 값 표시, 두 가지로 바로 판별 가능.**

핵심 공통 배경 (8장 자료 종합): 첫 재생 = `audioEl.play()` 순간에 **AVAudioSession 기동·카테고리 전환(ambient→playback)·하드웨어 라우트/샘플레이트/버퍼 재구성**이 한꺼번에 일어난다. WebKit은 정확히 이 "전환 순간"에 클록 질주(232728), 렌더러 왜곡(154538), 글루 미스캘리브레이션(221334)을 일으킨 전적이 있다. 두 번째 재생부터 정상인 이유는 세션이 이미 확정되어 전환이 없기 때문. **따라서 유망한 방향은 "전환이 끝나길 기다리기"(v9~v11, 전부 실패)가 아니라 "전환을 미리/무해하게 일으켜 두기"다.**

## 6. 제약 조건 (절대 준수)

1. **MediaStream→audio 라우팅 유지** — iPad 백그라운드 재생이 이 경로로 실제 동작 중. 직결로 바꾸면 기능 상실.
2. 룩어헤드 스케줄링 구조 유지 (setTimeout 직접 재생 금지).
3. 단일 파일(index.html) 유지, 빌드 도구 도입 금지.
4. 수정 후 `node test-metronome.mjs` 17개 체크 전부 PASS 유지.
5. UI 문구 추가 시 `I18N` 딕셔너리에 ko/en 쌍으로.

## 7. 권장 다음 단계

### 7-1. 진단 (수정 전에, 순서대로)

**A. 이어폰 테스트 (1분)**: 아이패드에 유선 이어폰 꽂고 첫 재생 → 연타음이 사라지면 H5(샘플레이트) 거의 확정.

**B. 라우팅 이등분 (5분)**: URL 쿼리(`?direct=1`)로 iOS에서도 `ctx.destination` 직결을 강제하는 디버그 분기 → 직결에서 연타음이 사라지면 원인은 media 경로(H2/H4), 직결에서도 나면 AudioContext 렌더링 자체(H3/H5). 진단용 분기이므로 제약 1 위반 아님.

**C. 화면 디버그 오버레이**: 첫 재생 후 5초간 200ms 간격으로 `ctx.currentTime / ctx.state / ctx.sampleRate / audioEl.currentTime / 가드 발동 횟수 / 예약 클릭 수`를 화면 구석 `<pre>`에 기록. 연타음 구간과 어느 지표 이상이 겹치는지로 가설을 판별한다. (Mac 원격 디버깅 불가 전제; 개발 이력상 화면 표시 방식이 실행 가능성이 높다)

**D. 녹음 파형**: 다른 폰으로 스피커를 녹음 — 동일 조각 반복(스터터)이면 H4, 정상 클릭 N발이 촘촘하면 스케줄/클록 계열.

### 7-2. 수정 후보 (진단 결과에 따라, 유망 순)

1. **첫 제스처 사전 예열 (업계 표준, 최유력)**: 재생 버튼이 아니라 **페이지 첫 사용자 터치(touchend 권장 — touchstart는 iOS에서 조용히 실패, miniaudio#759)**에서 즉시 `initAudio()` + `ctx.resume()` + `audioEl.play()` + 무음 버퍼 1개를 실제 출력 경로 전체로 재생해, 세션 기동·전환·글리치 구간을 **클릭이 하나도 없는 무음 시점**에 소진시킨다. 사용자가 재생을 누를 때는 이미 "논리적 두 번째 재생". "두 번째부터 정상"이라는 증상 자체가 이 방법의 유효성을 시사. (howler.js·cwilso/metronome PR#15·unmute-ios-audio가 전부 이 패턴)
2. **무음 keep-alive 병행**: 예열 후 게인 0의 `ConstantSourceNode`(또는 루프 무음 버퍼)를 상시 연결해 렌더/스트림이 계속 돌게 유지 — 정지→재시작 시 재구성 글리치도 예방.
3. **샘플레이트 점검·수정 (H5 확정 시)**: `ctx.sampleRate`가 하드웨어와 불일치하면 `ctx.close()` 후 `new AudioContext({sampleRate: 48000})`(또는 44100) 명시 재생성 — ios-safe-audio-context 레시피, godot#36643 해법.
4. **예약 시각 클램프 (저비용 보강)**: 모든 `start(t)`에서 `t=Math.max(t, ctx.currentTime+0.01)`로 클램프해 과거 시각 예약의 즉시 발화를 start() 단위에서 차단.
5. **AudioContext 완전 재생성 (강수)**: 클록 이상 감지 시 대기하지 말고 컨텍스트+그래프+스트림을 통째로 새로 구축 — **원조 cwilso/metronome의 iPad 이슈(#25)에서 resume 계열이 전부 실패한 뒤 유일하게 통한 방법** (참고 구현: github.com/nmcgann/metronome).
6. **첫 재생 게인 램프 (최후 완화책)**: 원인 제거가 안 되면 첫 재생 최초 1.5~2초 master gain 0→정상 램프인으로 글리치 구간을 들리지 않게.

## 8. 참고 자료 (웹 조사 결과 — 2026-08-01 실링크 검증 완료)

### WebKit 공식 버그 (이 증상과 부합하는 결함 클래스)

| 자료 | 핵심 내용 |
|---|---|
| [WebKit 232728](https://bugs.webkit.org/show_bug.cgi?id=232728) | **ctx.currentTime이 실시간의 최대 1.84배로 질주** (Safari 15 회귀). 원인: "WebAudio stack not dealing properly with the hardware sample rate changing". 수정됐으나 동류 회귀 반복 |
| [WebKit 154538](https://bugs.webkit.org/show_bug.cgi?id=154538) | 하드웨어 샘플레이트 44.1↔48k 전환 시 Web Audio 왜곡 — "the Web Audio engine chokes". 당시 워크어라운드: 컨텍스트 재생성 |
| [WebKit changeset 292563](https://trac.webkit.org/changeset/292563/webkit) | **`<audio srcObject>` 재생 시작 순간 오디오 유닛 버퍼를 100ms→20ms로 재구성** — 첫 재생 = 하드웨어 재구성이라는 직접 증거 |
| [WebKit 221334](https://bugs.webkit.org/show_bug.cgi?id=221334) | media element↔WebAudio 글루의 write-ahead가 재생 전환 시 1회만 계산돼 직후 1초+ 글리치 (미해결, Blocker) |
| [WebKit 263627](https://bugs.webkit.org/show_bug.cgi?id=263627) | iOS 17: **state='running'인데 currentTime 정지** — 상태/클록 폴링을 신뢰할 수 없는 공식 근거 (미해결) |
| [WebKit 319504](https://bugs.webkit.org/show_bug.cgi?id=319504) | **페이지 새로고침 후** AudioContext 초기화 시 클릭/팝 — "리로드 사이 오디오 하드웨어 해체·재초기화" (미해결). "새로고침마다 재발" 패턴과 부합 |
| [WebKit 274507](https://bugs.webkit.org/show_bug.cgi?id=274507) | iPadOS 17.5 한정: 44.1kHz 컨텍스트 왜곡 회귀, "리로드마다 발생 여부가 달라짐" |
| [WebKit 273511](https://bugs.webkit.org/show_bug.cgi?id=273511) | iOS 17: 초기화 직후 'interrupted' 고착, resume() 무력 (미해결) |

### 선행 사례 (같은 증상을 겪은 프로젝트들)

| 자료 | 핵심 내용 |
|---|---|
| [cwilso/metronome #25](https://github.com/cwilso/metronome/issues/25) | **원조 룩어헤드 메트로놈이 iPad Safari에서 클록 동결** — resume 계열 전부 실패, **AudioContext 완전 재생성만이 통함** (포크: nmcgann/metronome) |
| [cwilso/metronome #15](https://github.com/cwilso/metronome/issues/15) | iOS 무음 문제를 "첫 터치 이벤트에서 무음 버퍼 재생"으로 해결해 병합 |
| [Tone.js #134](https://github.com/Tonejs/Tone.js/issues/134) | "첫 페이지 로드만 왜곡, 리로드하면 정상, **내장 스피커에서만**" — 샘플레이트 불일치로 귀결 |
| [howler.js #1141](https://github.com/goldfire/howler.js/issues/1141) | iOS에서 컨텍스트가 잘못된 샘플레이트로 생성 → 크래클/팝. 스피커에서만 발생, 기기별 편차 |
| [W3C public-audio 2012 스레드](https://lists.w3.org/Archives/Public/public-audio/2012OctDec/0306.html) | 최초 보고: "클록이 흐르기 전 스케줄된 소리들이 **한꺼번에 터진다**". [Apple Jer Noble의 답변](https://lists.w3.org/Archives/Public/public-audio/2012OctDec/0310.html): 무음 재생 예열 관행의 원전 |
| [godot #36643](https://github.com/godotengine/godot/issues/36643) | iOS Safari 스터터링을 `new AudioContext({sampleRate:44100})` 명시로 해결 |
| [miniaudio #759](https://github.com/mackron/miniaudio/issues/759) | iOS 17: **touchstart에서의 언락은 조용히 실패, touchend에서만 성공** |

### 스펙/도구/현황

| 자료 | 핵심 내용 |
|---|---|
| [w3c mediacapture-streams §media elements](https://w3c.github.io/mediacapture-main/#mediastreams-in-media-elements) | MediaStream 재생은 스펙상 버퍼링/따라잡기 개념이 없고 currentTime은 단순 실시간 증가 — **v10 접근이 원리적으로 무효였던 근거** |
| [web-audio-api #2293](https://github.com/WebAudio/web-audio-api/issues/2293) | MSDN 스트림→`<audio srcObject>` 재생은 **스펙 미정의 동작** — 브라우저마다 다름 (이 앱의 핵심 경로) |
| [ios-safe-audio-context](https://github.com/Experience-Monks/ios-safe-audio-context) | 샘플레이트 이상 감지 → 더미 재생 → 컨텍스트 재생성 레시피 (커뮤니티 표준) |
| [swevans/unmute](https://github.com/swevans/unmute) | 무음 audio 요소 상시 재생으로 iOS 세션을 playback 카테고리에 고정하는 기법 문서화 |
| [feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio) | 첫 제스처에서 `<audio>`+AudioContext 동시 무음 재생으로 세션 승격 (BitMidi 프로덕션 사용) |
| [Chromium 41302928](https://issues.chromium.org/issues/41302928) | resume()의 promise가 **클록 시작 전에 resolve**됨 — "실제 출력 증거"(무음 소스 onended)를 기다려야 하는 근거 |
| [MacRumors — iOS 26 PWA 오디오 이슈](https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/) | iPadOS 26.0~26.2는 **PWA 한정 오디오 회귀 현재진행형** (Safari 탭은 정상). 기기 버전 확인 필수 |
| [prototyp.digital — PWA 오디오 경험담](https://prototyp.digital/blog/what-we-learned-about-pwas-and-audio-playback) | Safari 탭 vs 홈화면 PWA의 백그라운드 오디오 유지 조건 차이 실측 |
| [Velocaption — Procedural Audio](https://velocaption.com/blog/procedural-audio-in-the-browser/) | resume()은 제스처와 동기 틱에서 호출할 것 + **예약 시각 클램프** `Math.max(t, currentTime+0.01)` 권고 |

## 9. 검증 방법

- 회귀 방지: `node test-metronome.mjs` — 17개 체크 전부 PASS 필수 (Playwright + Chromium, 최초 1회 `npm i -D playwright && npx playwright install chromium`)
- 실기기 검증 절차: `APP_VER`(index.html 상단)을 올려 배포 → 아이패드에서 앱 완전 종료 → 두 번 열어 **헤더 버전 표기가 새 버전인지 확인** → 첫 재생 테스트. (버전 표기 확인 없이 테스트하면 stale-while-revalidate 캐시 때문에 구버전을 테스트하게 될 수 있음)
