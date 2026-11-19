import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
await p.goto('http://localhost:5183/?turn=800', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
let phase = '', round = 0;
const t0 = Date.now();
for (let i = 0; i < 150; i++) {
  await p.waitForTimeout(2000);
  const st = await p.evaluate(() => ({ ph: window.__STORE__.getState().game.phase, rd: window.__STORE__.getState().game.round }));
  phase = st.ph; round = st.rd;
  if (phase === 'game_end') break;
}
const secs = Math.round((Date.now() - t0) / 1000);
console.log(`结果: phase=${phase} round=${round} 用时=${secs}s`);
console.log('错误:', errs.length ? errs.slice(0,2) : '无');
await p.screenshot({ path: '/tmp/full-game.png' });
await b.close();
process.exit(phase === 'game_end' ? 0 : 1);
