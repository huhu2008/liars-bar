import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=2200', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');

// 每 60ms 采样一次关键状态
const log = [];
let prev = {};
const t0 = Date.now();
for (let i = 0; i < 1200; i++) {
  const s = await p.evaluate(() => {
    const st = window.__STORE__.getState();
    return {
      round: st.game?.round,
      phase: st.game?.phase,
      hand: st.game?.players?.[0]?.hand?.length ?? 0,
      collect: st.collectHand,
      deal: st.dealSignal,
      revealAt: st.revealAt,
    };
  });
  for (const k of Object.keys(s)) {
    if (s[k] !== prev[k]) {
      log.push({ at: Date.now() - t0, k, v: s[k] });
      prev[k] = s[k];
    }
  }
  if (s.round >= 3) break;
  await p.waitForTimeout(60);
}
const base = log[0]?.at ?? 0;
for (const e of log) {
  if (['collect', 'deal', 'hand', 'round'].includes(e.k)) {
    console.log(`${((e.at - base) / 1000).toFixed(2).padStart(6)}s  ${e.k.padEnd(8)} = ${e.v}`);
  }
}
await b.close();
