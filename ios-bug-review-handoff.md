# SLGMetronome iPadOS 첫 재생 연타음 — 2차 검토 인수인계

작성일: 2026-08-02  
대상 문서: `ios-bug-handoff.md`  
검토 대상 코드: `index.html` v17

## 1. 이 문서의 목적과 현재 상태

기존 인수인계 문서와 현재 소스를 다시 검토하고, WebKit 공식 버그 및 실제 수정 커밋을 원문과 대조했다.

중요:

- 아직 `index.html`은 수정하지 않았다.
- iPad 실기기 없이 확인 가능한 정적 분석과 문헌 검증만 완료했다.
- 따라서 원인을 하나로 확정하거나 수정안을 최종 적용하지 않았다.
- 이 문서의 진단 코드는 원인 확정을 위한 검토안이다.
- `MediaStreamAudioDestinationNode → <audio srcObject>` 백그라운드 재생 경로와 Web Worker 룩어헤드 스케줄러는 유지한다.

실기기 정보:

- iPad 모델/iPadOS 버전: 현재 확인 불가
- Safari 탭과 설치형 PWA: 둘 다 재현
- 이어폰/블루투스 연결 비교: 미실시
- 향후 진단 빌드 배포와 화면 로그 회수: 가능

## 2. 이번 검토에서 수행한 작업

### 2-1. 현재 코드와 세 번의 기존 수정 이력 검토

다음 커밋의 실제 diff를 확인했다.

- `f19e92f`: `waitForClock()`과 첫 클릭 0.35초 지연
- `1f1dbf0`: `audioEl.currentTime` 기반 `waitForLiveEdge()`
- `58a0b76`: `waitForSteadyClock()`과 연속 재동기화 방지

현재 v17의 시작 흐름도 확인했다.

```js
initAudio();
state.playing=true;
await ensureRoute();
if(!warmedUp){await waitForClock();await waitForSteadyClock();}
nextTime=ctx.currentTime+(warmedUp?.1:.35);
ticker.start();
```

스케줄러는 첫 시작에서 미래 시각부터 예약하며 Worker도 하나만 생성한다. 현재 코드만 놓고 보면 첫 1~2초 동안 의도하지 않은 클릭 여러 개를 중복 예약할 명백한 경로는 발견하지 못했다.

### 2-2. WebKit 자료를 제목이 아닌 원문과 수정 커밋 기준으로 재검증

확인한 주요 자료:

- WebKit 221334: https://bugs.webkit.org/show_bug.cgi?id=221334
- WebKit 232728: https://bugs.webkit.org/show_bug.cgi?id=232728
- WebKit 239696: https://bugs.webkit.org/show_bug.cgi?id=239696
- WebKit 236363 / changeset 292563:
  - https://bugs.webkit.org/show_bug.cgi?id=236363
  - https://trac.webkit.org/changeset/292563/webkit
- WebKit 154538: https://bugs.webkit.org/show_bug.cgi?id=154538
- WebKit 274507: https://bugs.webkit.org/show_bug.cgi?id=274507
- WebKit 263627: https://bugs.webkit.org/show_bug.cgi?id=263627
- WebKit 273511: https://bugs.webkit.org/show_bug.cgi?id=273511
- WebKit 319504: https://bugs.webkit.org/show_bug.cgi?id=319504
- cwilso/metronome #25:
  https://github.com/cwilso/metronome/issues/25
- howler.js #1141:
  https://github.com/goldfire/howler.js/issues/1141
- ios-safe-audio-context:
  https://github.com/Jam3/ios-safe-audio-context

### 2-3. 로컬 자동 테스트 시도

`node test-metronome.mjs`를 실행했지만 Playwright Chromium 실행 파일이 설치되어 있지 않아 브라우저 시작 전에 중단됐다.

이는 앱 테스트 실패가 아니라 로컬 테스트 환경 누락이다.

```text
browserType.launch: Executable doesn't exist
Please run: npx playwright install
```

아직 앱 코드를 바꾸지 않았으므로 브라우저 설치는 진행하지 않았다.

## 3. 기존 인수인계 내용에서 수정해야 할 부분

### 3-1. WebKit 221334는 현재 앱 경로의 직접 증거가 아니다

기존 문서는 221334를 `MediaStreamAudioDestinationNode → <audio>` 경로의 강한 근거처럼 사용했다.

그러나 해당 버그의 재현 경로는 주로 다음 방향이다.

```text
HTMLMediaElement
  → MediaElementAudioSourceNode
  → WebAudio
```

현재 앱은 반대 방향이다.

```text
WebAudio
  → MediaStreamAudioDestinationNode
  → HTMLAudioElement.srcObject
```

221334는 Safari의 미디어/WebAudio 접합부가 지연과 스터터에 취약하다는 간접 근거로는 유효하지만, 현재 앱의 직접적인 구현 근거로 단정하면 안 된다.

### 3-2. changeset 292563의 의미를 더 정확히 적용해야 한다

이 커밋은 오디오 MediaStreamTrack을 재생할 때 CoreAudio의 preferred buffer size를 약 100ms에서 20ms로 줄이는 변경이다.

즉, `audioEl.play()`로 MediaStreamTrack 재생이 시작될 때 플랫폼 오디오 세션의 버퍼 구성이 달라질 수 있다는 직접 근거다.

다만 이 커밋 자체가 “현재 연타음과 동일한 버그”를 고쳤다는 뜻은 아니다. 현재 앱의 첫 재생 시점에 하드웨어/렌더러 재구성이 일어날 수 있음을 뒷받침하는 자료로 사용해야 한다.

### 3-3. H5의 정의를 수정해야 한다

현재 클릭 버퍼는 외부 오디오 파일이 아니라 다음처럼 `ctx.sampleRate`로 직접 합성된다.

```js
const sr=ctx.sampleRate;
const buf=ctx.createBuffer(1,n,sr);
```

따라서 단순한 “클릭 파일과 AudioContext의 샘플레이트 불일치”는 아니다.

검증할 H5는 다음과 같이 다시 정의하는 편이 정확하다.

> AudioContext가 만들어진 뒤 `audioEl.play()`가 AVAudioSession의 하드웨어 샘플레이트 또는 버퍼 구성을 변경하고, 기존 AudioContext/MediaStream 렌더러가 이전 포맷이나 잘못된 producer/consumer 페이스를 유지한다.

WebKit 232728의 실제 원인도 하드웨어 샘플레이트 변경 뒤 WebProcess가 GPUProcess보다 많은 프레임을 생성해 점점 앞서 나가던 문제였다. 다만 232728과 154538은 이미 수정된 과거 버그이므로, 현재 증상을 동일 버그라고 단정하지 말고 동류 회귀 가능성의 근거로만 사용해야 한다.

### 3-4. “무음 버퍼 예열”이 현재 코드에서 중복일 가능성이 있다

현재 코드는 `audioEl.play()` 후 클릭 예약 전까지 MediaStream을 재생한다. 그동안 `master → msDest` 경로에는 이미 디지털 무음이 흐른다.

따라서 같은 경로에 1프레임짜리 완전 무음 버퍼를 추가하는 것만으로는 현재 동작과 물리적으로 큰 차이가 없을 수 있다.

WebKit이 첫 non-zero 샘플이 들어올 때 실제 audible output 전환이나 렌더러 초기화를 수행한다면, 완전 무음 예열은 효과가 없고 첫 클릭에서 다시 문제가 시작된다.

이 때문에 단순 무음 버퍼 적용 전에 아래 H6을 먼저 검증해야 한다.

## 4. 갱신된 가설 평가

### H1: 오디오 세션 시작 지연으로 예약 클릭이 밀렸다가 한꺼번에 재생

평가: 거의 기각.

- `waitForClock()` 적용 실패
- 첫 클릭 0.35초 지연 실패
- 두 번째 재생은 정상

단순히 클릭 예약을 더 늦추는 방식은 반복하지 않는다.

### H2: `<audio srcObject>` 출력 경로의 시작 글리치

평가: 중간 이상.

- 현재 앱의 특수 경로에만 존재하는 구성 요소다.
- `?direct=1` 이등분 진단을 아직 하지 않았다.
- 221334는 간접 근거일 뿐이다.
- changeset 292563은 MediaStreamTrack 재생 시 플랫폼 버퍼 구성이 바뀔 수 있다는 직접 근거다.

### H3: AudioContext 클록 질주 또는 스케줄러 재동기화 연타

평가: 낮음, 단 아직 완전 기각은 아님.

- `waitForSteadyClock()` 적용 실패
- 연속 재동기화 시 예약 생략도 실패
- 현재 스케줄러에서 중복 Worker나 무제한 catch-up 예약 경로를 찾지 못함

진단 로그에서 `clockRate`, 재동기화 횟수, 예약 횟수를 동시에 기록하면 확정할 수 있다.

### H4: MediaStream/HTMLMediaElement/CoreAudio 출력 렌더러 글리치

평가: 높음.

- 정상 예약 로그와 실제 스피커 출력이 다를 수 있다.
- JS에서 관찰하는 `ctx.currentTime`이 정상이어도 출력단 producer/consumer가 잘못 움직일 수 있다.
- 첫 `audioEl.play()` 시 플랫폼 버퍼 재구성 가능성이 공식 커밋으로 확인된다.

### H5: `audioEl.play()`가 유발한 하드웨어 포맷 변경 뒤 기존 컨텍스트 불일치

평가: 중간.

- `ctx.sampleRate` 하나만 표시해서는 확정할 수 없다.
- `44100`과 `48000`으로 각각 새 컨텍스트를 만든 A/B 테스트가 필요하다.
- 특정 값이 정상이라고 확인되기 전 48kHz를 임의로 고정하면 안 된다.

### H6: 완전 무음 동안에는 실제 출력 경로가 초기화되지 않고 첫 non-zero 샘플에서 전환

평가: 가장 유력한 신규 가설.

다음 관찰을 함께 설명한다.

- `audioEl.play()` 후 오래 기다려도 실패
- `ctx.currentTime` 안정화를 기다려도 실패
- 첫 실제 클릭부터 1~2초만 손상
- 동일 페이지의 두 번째 재생은 정상

진단 방법은 MediaStream 경로에 완전 무음이 아닌 매우 작은 연속 신호를 먼저 1.2초 흘린 뒤 클릭을 시작하는 것이다.

이 테스트가 성공하면 “기다리는 시간”이 아니라 “첫 실제 오디오 데이터를 무해한 신호로 먼저 통과시켰는가”가 차이를 만든 것으로 볼 수 있다.

## 5. 권장 실기기 진단 설계

하나의 빌드에서 URL 쿼리로 다음 모드를 선택할 수 있게 한다.

```text
?diag=media                 기존 MediaStream 경로
?diag=direct                AudioContext → ctx.destination 직결
?diag=prime                 MediaStream 경로 + 저레벨 non-zero 프라임
?diag=media&sr=48000        48kHz 컨텍스트
?diag=media&sr=44100        44.1kHz 컨텍스트
```

화면 오버레이에는 다음을 기록한다.

- `performance.now()`
- `ctx.currentTime`
- `ctx.currentTime / performance.now()` 진행 비율
- `ctx.state`
- `ctx.sampleRate`
- `ctx.baseLatency`, `ctx.outputLatency`
- `ctx.getOutputTimestamp()` 결과
- `audioEl.currentTime`, `paused`, `readyState`
- `<audio>`의 `play`, `playing`, `waiting`, `stalled`, `suspend`, `pause`, `emptied`
- MediaStream track의 `readyState`, `muted`, `getSettings()`
- 스케줄된 노트 수
- 각 노트의 요청 시각과 예약 당시 lead time
- 재동기화 가드 발동 횟수

## 6. 진단 코드 검토안

### 6-1. 쿼리와 화면 로그

`IS_IOS` 선언 다음에 추가한다.

```js
const DIAG_Q = new URLSearchParams(location.search);
const DIAG_MODE = DIAG_Q.get('diag') || '';
const DIAG_SR = Number(DIAG_Q.get('sr')) || 0;

const audioDiag = {
  scheduled: 0,
  resyncs: 0,
  rows: [],
  timer: null
};

function diagEvent(type, extra = {}) {
  audioDiag.rows.push({
    wall: Math.round(performance.now()),
    type,
    ctxTime: ctx?.currentTime ?? null,
    ctxState: ctx?.state ?? null,
    sampleRate: ctx?.sampleRate ?? null,
    routed,
    ...extra
  });
  if (audioDiag.rows.length > 150) audioDiag.rows.shift();
}

function startDiagOverlay() {
  if (!DIAG_MODE || audioDiag.timer) return;

  const pre = document.createElement('pre');
  pre.id = 'audio-diag';
  Object.assign(pre.style, {
    position: 'fixed',
    inset: '4px',
    zIndex: 99999,
    overflow: 'auto',
    pointerEvents: 'none',
    background: '#000e',
    color: '#0f0',
    padding: '8px',
    font: '11px/1.3 monospace'
  });
  document.body.appendChild(pre);

  let lastWall = performance.now();
  let lastCtx = ctx.currentTime;

  audioDiag.timer = setInterval(() => {
    const wall = performance.now();
    const ct = ctx.currentTime;
    const clockRate = (ct - lastCtx) / ((wall - lastWall) / 1000);
    const stamp = ctx.getOutputTimestamp?.();
    const track = msDest?.stream.getAudioTracks()[0];

    diagEvent('sample', {
      clockRate: +clockRate.toFixed(3),
      audioTime: audioEl?.currentTime ?? null,
      audioPaused: audioEl?.paused ?? null,
      audioReadyState: audioEl?.readyState ?? null,
      baseLatency: ctx.baseLatency ?? null,
      outputLatency: ctx.outputLatency ?? null,
      outputContextTime: stamp?.contextTime ?? null,
      outputPerformanceTime: stamp?.performanceTime ?? null,
      trackState: track?.readyState ?? null,
      trackMuted: track?.muted ?? null,
      trackSettings: track?.getSettings?.() ?? null,
      scheduled: audioDiag.scheduled,
      resyncs: audioDiag.resyncs
    });

    pre.textContent = JSON.stringify(audioDiag.rows.slice(-16), null, 2);
    lastWall = wall;
    lastCtx = ct;
  }, 100);

  setTimeout(() => {
    clearInterval(audioDiag.timer);
    audioDiag.timer = null;
  }, 7000);
}
```

### 6-2. 진단용 sampleRate 선택

기존 AudioContext 생성부를 다음처럼 바꾼다.

```js
const options = {latencyHint:'interactive'};
if (DIAG_SR) options.sampleRate = DIAG_SR;

try {
  ctx = new AC(options);
} catch (_) {
  ctx = new AC({latencyHint:'interactive'});
}
```

진단 전용 쿼리이므로 기본 동작에는 sampleRate를 강제하지 않는다.

### 6-3. 직결 이등분

`initAudio()`의 라우팅 부분을 진단 중에만 분기한다.

```js
audioEl=$('#audio-out');

if (DIAG_MODE === 'direct') {
  master.connect(ctx.destination);
  routed='direct';
} else {
  try {
    msDest=ctx.createMediaStreamDestination();
    master.connect(msDest);
    audioEl.srcObject=msDest.stream;
  } catch (e) {
    msDest=null;
  }

  if (!msDest) {
    master.connect(ctx.destination);
    routed='direct';
  }
}
```

이는 원인 이등분용 URL에서만 작동하며, 제품의 MediaStream 백그라운드 경로를 제거하는 변경이 아니다.

### 6-4. 이벤트 및 스케줄 계측

`initAudio()`에서 `audioEl` 생성 후 한 번 등록한다.

```js
for (const name of ['play','playing','waiting','stalled','suspend','pause','emptied']) {
  audioEl.addEventListener(name, () => diagEvent('audio-' + name));
}
ctx.addEventListener('statechange', () => diagEvent('ctx-statechange'));
```

`schedulerTick()`의 재동기화 가드에 추가한다.

```js
audioDiag.resyncs++;
```

`scheduleNote(t)` 시작 부분에 추가한다.

```js
audioDiag.scheduled++;
diagEvent('schedule', {
  requestedTime: t,
  lead: t - ctx.currentTime
});
```

`ensureRoute()` 완료 후 호출한다.

```js
diagEvent('route-ready', {
  audioPaused: audioEl?.paused,
  audioReadyState: audioEl?.readyState
});
startDiagOverlay();
```

### 6-5. H6용 non-zero 프라임

완전 무음이 아니라 약 -66dB의 작은 연속 신호를 실제 `msDest`에 직접 보낸다.

```js
let mediaPathPrimed = false;

async function primeMediaPath() {
  if (mediaPathPrimed || DIAG_MODE !== 'prime' || routed !== 'media' || !msDest) return;
  mediaPathPrimed = true;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.frequency.value = 997;
  gain.gain.value = 0.0005;
  osc.connect(gain).connect(msDest);

  const start = ctx.currentTime + 0.02;
  const ended = new Promise(resolve => {
    osc.addEventListener('ended', resolve, {once:true});
  });

  osc.start(start);
  osc.stop(start + 1.2);

  await Promise.race([
    ended,
    new Promise(resolve => setTimeout(resolve, 1800))
  ]);

  diagEvent('media-prime-ended');
}
```

`togglePlay()`에서 `ensureRoute()` 직후, 실제 메트로놈 예약 전에 호출한다.

```js
await ensureRoute();
await primeMediaPath();
```

이 코드는 검증 전에는 제품 수정안이 아니라 진단 분기다.

## 7. 결과 판정표

### `direct`만 정상

결론:

- Web Worker/AudioContext 노트 스케줄러가 원인이 아니다.
- `MediaStreamAudioDestinationNode → HTMLAudioElement → CoreAudio` 경로의 H2/H4가 확정된다.

다음 단계:

- `prime` 결과로 시작 전환 문제인지 지속적인 renderer 문제인지 추가 분리한다.

### `prime`이 정상

결론:

- H6이 강하게 확정된다.
- 기다린 시간이나 `currentTime` 안정 여부가 아니라, 첫 non-zero 데이터를 실제 출력 경로에 미리 통과시키는 것이 핵심이다.

최종 수정 방향:

- 제품 코드에서 iOS 첫 실행 한 번만 `primeMediaPath()` 실행
- MediaStream 백그라운드 경로 유지
- Worker/룩어헤드 스케줄러 유지
- 기존 클록 가드는 탭 동결 복귀 보호용으로 유지

### 특정 sampleRate만 정상

결론:

- H5가 확정된다.

주의:

- 한 기기에서 48kHz가 성공했다고 모든 iPad에 48kHz를 무조건 고정하지 않는다.
- 가능하면 오디오 세션을 먼저 프라임한 뒤 전체 AudioContext/그래프를 재생성해 최종 하드웨어 설정에 맞추는 방식을 검토한다.
- 컨텍스트 재생성 시 `master`, `boost`, `limiter`, `msDest`, 클릭 버퍼, `audioEl.srcObject`를 모두 다시 만들어야 한다.

### `clockRate` 또는 재동기화 횟수가 급증

결론:

- H3 계열이다.

다음 단계:

- 기다리기로 해결하지 말고 비정상 컨텍스트와 그래프를 닫고 재생성한다.
- cwilso/metronome #25에서 사용한 대응과 같은 방향이다.

### 예약 로그는 정상인데 media/prime 모두 깨짐

결론:

- JS 스케줄러 외부의 H4 가능성이 가장 높다.

다음 단계:

- iPadOS 버전 확인
- 외부 기기로 출력 파형 녹음
- 이어폰/블루투스/내장 스피커 비교
- 필요 시 첫 재생을 감추는 gain ramp는 원인 제거가 불가능할 때만 최후 수단으로 고려

## 8. H6 확정 시의 수정 코드

`prime` 진단에서 문제가 사라진 경우에만 다음처럼 제품 코드로 승격한다.

```js
let mediaPathPrimed=false;

async function primeMediaPath(){
  if(mediaPathPrimed||!IS_IOS||routed!=='media'||!msDest)return;
  mediaPathPrimed=true;

  const osc=ctx.createOscillator();
  const gn=ctx.createGain();
  osc.frequency.value=997;
  gn.gain.value=.0005;
  osc.connect(gn).connect(msDest);

  const start=ctx.currentTime+.02;
  const ended=new Promise(resolve=>osc.addEventListener('ended',resolve,{once:true}));
  osc.start(start);
  osc.stop(start+1.2);

  await Promise.race([
    ended,
    new Promise(resolve=>setTimeout(resolve,1800))
  ]);
}
```

시작 흐름:

```js
initAudio();
state.playing=true;
await ensureRoute();
await primeMediaPath();
if(!warmedUp){await waitForClock();await waitForSteadyClock();}
```

기존 `waitForClock()`과 `waitForSteadyClock()`은 이미 이 버그를 해결하지 못했지만, 워크스페이스 규칙상 iOS 클록 이상 및 탭 동결 복귀 방어로 유지한다. H6 수정의 핵심은 이 대기 함수들이 아니라 실제 MediaStream에 먼저 non-zero 신호를 통과시키는 부분이다.

프라임 레벨과 길이는 실기기 결과를 보고 최소화한다. 너무 작은 레벨은 WebKit 내부에서 완전 무음처럼 처리될 수 있고, 너무 크면 사용자에게 예열음이 들릴 수 있다.

## 9. 원 작업 AI가 검토해야 할 핵심 질문

1. 221334를 현재 경로의 직접 근거에서 간접 근거로 낮추는 데 동의하는가?
2. 현재 `master → msDest`가 클릭 전부터 디지털 무음을 생성하므로, 1프레임 무음 버퍼 추가가 실질적으로 중복이라는 분석에 동의하는가?
3. `audioEl.play()` 후 첫 non-zero 데이터에서만 renderer/session이 완전히 활성화될 가능성을 WebKit 구현상 어떻게 평가하는가?
4. `?diag=direct`, `?diag=prime`, `?sr=44100/48000` 순서가 최소 실기기 테스트로 충분한가?
5. non-zero 프라임이 성공할 경우 oscillator를 `msDest`에 직접 연결하는 방식이 백그라운드 라우팅과 오디오 세션 유지에 부작용이 없는가?
6. sampleRate 테스트가 성공할 경우 하드코딩과 컨텍스트 재생성 중 어느 방식을 택할 것인가?
7. 진단 오버레이가 iPad 성능이나 메인 스레드 부하로 결과를 교란하지 않도록 100ms 주기와 7초 제한이 적절한가?

## 10. 적용 전 체크리스트

- [ ] 원 작업 AI의 기술 검토
- [ ] 진단 코드만 적용하고 `APP_VER` 증가
- [ ] Playwright Chromium 설치 후 기존 자동 테스트 전체 PASS
- [ ] `shot-phone.png`, `shot-desktop.png` 레이아웃 확인
- [ ] 배포 후 iPad에서 표시 버전 확인
- [ ] Safari 탭과 설치 PWA 각각 `media/direct/prime` 테스트
- [ ] 화면 로그 또는 촬영 영상 회수
- [ ] 원인 판정 후 진단 코드 제거
- [ ] 확정된 원인에 해당하는 수정만 적용
- [ ] MediaStream 백그라운드 경로 유지 확인
- [ ] Worker 25ms + AudioContext 0.18초 룩어헤드 유지 확인
- [ ] 최종 자동 테스트와 iPad 첫 재생/두 번째 재생/백그라운드 재생 확인

