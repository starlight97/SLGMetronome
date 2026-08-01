import { chromium } from 'playwright';

const APP_URL = new URL('./index.html', import.meta.url).href;

const results = [];
const check = (name, cond, detail='') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(APP_URL);
await page.waitForTimeout(400);

// --- 1. 기본 스케줄링 정확도 (120 BPM, 4분음표 → 0.5s 간격) ---
await page.click('#play');
await page.waitForTimeout(2600);
let dbg = await page.evaluate(() => ({
  times: window.__dm.times,
  bpm: window.__dm.state.bpm,
  subdiv: window.__dm.state.subdiv,
  routed: window.__dm.routed,
  ctx: window.__dm.ctxTime(),
  playing: window.__dm.state.playing
}));
check('재생 시작됨', dbg.playing && dbg.ctx > 0, `ctxTime=${dbg.ctx.toFixed(2)} routed=${dbg.routed}`);
const diffs = dbg.times.slice(1).map((t, i) => t - dbg.times[i]);
const expected = 60 / dbg.bpm / dbg.subdiv;
const maxErr = Math.max(...diffs.map(d => Math.abs(d - expected)));
check('스케줄 간격 정확도', diffs.length >= 4 && maxErr < 0.0001,
  `n=${diffs.length} expected=${expected} maxErr=${maxErr.toExponential(2)}`);

// --- 2. 서브디비전 전환 (16분 → 간격 1/4) ---
await page.click('#subdiv .chip[data-v="4"]');
await page.waitForTimeout(1600);
dbg = await page.evaluate(() => ({ times: window.__dm.times, bpm: window.__dm.state.bpm }));
const last = dbg.times.slice(-8);
const d2 = last.slice(1).map((t, i) => t - last[i]);
const exp2 = 60 / dbg.bpm / 4;
const err2 = Math.max(...d2.map(d => Math.abs(d - exp2)));
check('서브디비전 16분 전환', err2 < 0.0001, `expected=${exp2} maxErr=${err2.toExponential(2)}`);

// --- 2b. 리듬 패턴 (점8분+16분 → 120 BPM에서 0.375/0.125 교대) ---
await page.click('#subdiv .chip[data-v="d8_16"]');
await page.waitForTimeout(2600);
dbg = await page.evaluate(() => ({ times: window.__dm.times }));
const lastP = dbg.times.slice(-7);
const dP = lastP.slice(1).map((t, i) => t - lastP[i]);
const okVals = dP.every(d => Math.abs(d - 0.375) < 0.0002 || Math.abs(d - 0.125) < 0.0002);
const okAlt = dP.slice(1).every((d, i) => Math.abs(d + dP[i] - 0.5) < 0.0004);
check('리듬 패턴 점8분+16분', dP.length >= 5 && okVals && okAlt,
  `diffs=[${dP.map(d => d.toFixed(3)).join(',')}]`);
await page.click('#subdiv .chip[data-v="1"]');

// --- 3. 정지 ---
await page.click('#play');
await page.waitForTimeout(300);
dbg = await page.evaluate(() => ({ playing: window.__dm.state.playing }));
check('정지 동작', !dbg.playing);

// --- 4. 탭 템포 (페이지 내부에서 300ms 간격 클릭 → ~200 BPM) ---
await page.evaluate(() => new Promise(res => {
  const btn = document.querySelector('#tap');
  let n = 0;
  const id = setInterval(() => { btn.click(); if (++n >= 5) { clearInterval(id); res(); } }, 300);
}));
dbg = await page.evaluate(() => ({ bpm: window.__dm.state.bpm }));
check('탭 템포', dbg.bpm > 190 && dbg.bpm < 210, `bpm=${dbg.bpm} (기대 ~200)`);

// --- 5. 강세 사이클 (첫 박: 강→중→무음→강) ---
const cls = async () => page.getAttribute('#dots .dot:first-child', 'class');
const c0 = await cls();
await page.click('#dots .dot:first-child'); const c1 = await cls();
await page.click('#dots .dot:first-child'); const c2 = await cls();
await page.click('#dots .dot:first-child'); const c3 = await cls();
check('강세 사이클', c0.includes('l2') && c1.includes('l1') && c2.includes('l0') && c3.includes('l2'),
  `${c0} → ${c1} → ${c2} → ${c3}`);

// --- 6. 박자 변경 (4 → 5) ---
await page.click('#beats-plus');
const nDots = await page.evaluate(() => document.querySelectorAll('#dots .dot').length);
check('박자 변경 5박', nDots === 5, `dots=${nDots}`);
await page.click('#beats-minus');

// --- 7. 프리셋 저장/로드 ---
await page.fill('#preset-name', '테스트 곡');
await page.click('#preset-save');
let nPresets = await page.evaluate(() => document.querySelectorAll('.preset').length);
const savedBpm = await page.evaluate(() => window.__dm.state.bpm);
check('프리셋 저장', nPresets === 1, `presets=${nPresets}`);
await page.click('#bpm-m5');
await page.click('#bpm-m5');
await page.click('.preset-load');
dbg = await page.evaluate(() => ({ bpm: window.__dm.state.bpm }));
check('프리셋 로드 (BPM 복원)', dbg.bpm === savedBpm, `${dbg.bpm} === ${savedBpm}`);

// --- 8. 퀵 BPM 버튼 (추가 → 적용 → 삭제) ---
const qBpm = await page.evaluate(() => window.__dm.state.bpm);
await page.click('.quick-add');
const nQuick = await page.evaluate(() => document.querySelectorAll('.quick-chip').length);
await page.click('#bpm-m5');
await page.click('.quick-chip .quick-set');
const qSet = await page.evaluate(() => window.__dm.state.bpm);
await page.click('.quick-chip .quick-del');
const nQuick2 = await page.evaluate(() => document.querySelectorAll('.quick-chip').length);
check('퀵 BPM 추가/적용/삭제', nQuick === 1 && qSet === qBpm && nQuick2 === 0,
  `chips=${nQuick}→${nQuick2} bpm=${qSet} (기대 ${qBpm})`);

// --- 9. 퀵 BPM 드래그 순서 변경 (200,195 → 195,200) ---
// 탭 템포 결과에는 ±1 BPM 지터가 있으므로 이후 체크의 기준 BPM을 정확히 200으로 고정
await page.evaluate(() => {
  const r = document.querySelector('#bpm-range');
  r.value = '200';
  r.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.click('.quick-add');                       // 200 추가
await page.click('#bpm-m5');                          // bpm 195
await page.click('.quick-add');                       // 195 추가 → [200,195]
const qBefore = await page.evaluate(() => window.__dm.state.quickBpms.slice());
const boxA = await page.locator('.quick-chip').first().boundingBox();
const boxB = await page.locator('.quick-chip').nth(1).boundingBox();
await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
await page.mouse.down();
await page.mouse.move(boxB.x + boxB.width * 0.9, boxB.y + boxB.height / 2, { steps: 8 });
await page.mouse.up();
const qAfter = await page.evaluate(() => window.__dm.state.quickBpms.slice());
check('퀵 BPM 드래그 순서 변경',
  qBefore[0] === 200 && qBefore[1] === 195 && qAfter[0] === 195 && qAfter[1] === 200,
  `[${qBefore}] → [${qAfter}]`);

// --- 10. 퀵 BPM 정렬 버튼 (내림차순 → 오름차순) ---
await page.click('#quick-desc');
const qDesc = await page.evaluate(() => window.__dm.state.quickBpms.slice());
await page.click('#quick-asc');
const qAsc = await page.evaluate(() => window.__dm.state.quickBpms.slice());
check('퀵 BPM 정렬 (내림/오름)',
  qDesc[0] === 200 && qDesc[1] === 195 && qAsc[0] === 195 && qAsc[1] === 200,
  `desc=[${qDesc}] asc=[${qAsc}]`);

// --- 11. 퀵 BPM 길게 눌러 값 수정 (195 → 240, BPM은 그대로) ---
const bpmBeforeHold = await page.evaluate(() => window.__dm.state.bpm);
const boxE = await page.locator('.quick-chip').first().boundingBox();
await page.mouse.move(boxE.x + boxE.width / 2, boxE.y + boxE.height / 2);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
const modalShown = await page.evaluate(() => !document.querySelector('#quick-edit-back').hidden);
await page.fill('#quick-edit-in', '240');
await page.click('#quick-edit-ok');
const qEdited = await page.evaluate(() => window.__dm.state.quickBpms.slice());
const modalHidden = await page.evaluate(() => document.querySelector('#quick-edit-back').hidden);
const bpmAfterHold = await page.evaluate(() => window.__dm.state.bpm);
check('퀵 BPM 길게 눌러 값 수정',
  modalShown && modalHidden && qEdited[0] === 240 && qEdited[1] === 200 && bpmAfterHold === bpmBeforeHold,
  `modal=${modalShown} → [${qEdited}] bpm=${bpmAfterHold}(기대 ${bpmBeforeHold})`);

// --- 12. 템포 트레이너 (매 1마디 +10, 목표 170 → 2마디 후 도달) ---
await page.evaluate(() => {
  const s = window.__dm.state;
  s.bpm = 150; document.querySelector('#bpm-num').textContent = '150';
});
await page.click('#tr-on');
await page.fill('#tr-every', '1'); await page.dispatchEvent('#tr-every', 'change');
await page.fill('#tr-step', '10'); await page.dispatchEvent('#tr-step', 'change');
await page.fill('#tr-target', '170'); await page.dispatchEvent('#tr-target', 'change');
await page.click('#play');
await page.waitForTimeout(4200);
dbg = await page.evaluate(() => ({ bpm: window.__dm.state.bpm }));
check('템포 트레이너 목표 도달', dbg.bpm === 170, `bpm=${dbg.bpm}`);
await page.click('#play');

// --- 12b. 화면 싱크 보정 (슬라이더 → 상태/보정값 반영, 재로드 후 복원) ---
dbg = await page.evaluate(() => {
  const s = document.querySelector('#av-offset');
  const set = v => { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); };
  set(0); const c0 = window.__dm.avComp;
  set(40); const c40 = window.__dm.avComp;   // 40으로 남겨 재로드 복원까지 검증
  return {
    delta: c40 - c0,
    off: window.__dm.state.avOffsetMs,
    val: document.querySelector('#av-val').textContent
  };
});
const compOk = Math.abs(dbg.delta - 0.04) < 0.005;  // 오프셋 항이 avComp에 실제로 반영되는지 (outputLatency와 무관하게)
await page.waitForTimeout(400);                  // persist 디바운스(250ms) 대기
await page.reload();
await page.waitForTimeout(400);
const dbg2 = await page.evaluate(() => ({
  off: window.__dm.state.avOffsetMs,
  slider: document.querySelector('#av-offset').value
}));
check('화면 싱크 보정 슬라이더', dbg.off === 40 && compOk && dbg.val === '+40ms'
  && dbg2.off === 40 && dbg2.slider === '40',
  `off=${dbg.off} compDelta=${dbg.delta} val=${dbg.val} reload=[${dbg2.off},${dbg2.slider}]`);

// --- 13. 콘솔 에러 ---
const realErrors = errors.filter(e => !/autoplay|AudioContext was not allowed/i.test(e));
check('콘솔 에러 없음', realErrors.length === 0, realErrors.join(' | ').slice(0, 300));

// --- 스크린샷 ---
await page.screenshot({ path: 'shot-phone.png', fullPage: false });
const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desktop.goto(APP_URL);
await desktop.waitForTimeout(400);
await desktop.screenshot({ path: 'shot-desktop.png' });

await browser.close();
const fails = results.filter(r => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
