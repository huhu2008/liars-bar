import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5183/?turn=20000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3000);

// ① 语音开关
await p.getByRole('button', { name: /语音|静音/ }).click();
const v1 = await p.evaluate(() => window.__STORE__.getState().voiceOn);
await p.getByRole('button', { name: /语音|静音/ }).click();
const v2 = await p.evaluate(() => window.__STORE__.getState().voiceOn);
console.log('语音开关: 关→', v1, ' 开→', v2);

// ② 窗口缩放
for (const [w, h] of [[900, 600], [1600, 900], [1280, 820]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(700);
  const ok = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    return c && c.width > 0 && c.height > 0;
  });
  console.log(`resize ${w}x${h}: canvas ${ok ? 'ok' : '坏'}`);
}
await p.screenshot({ path: '/tmp/resize.png' });

// ③ 重开后状态
await p.getByRole('button', { name: /重开/ }).click();
await p.waitForTimeout(2200);
const st = await p.evaluate(() => {
  const s = window.__STORE__.getState();
  return { screen: s.screen, round: s.game?.round, hand: s.game?.players?.[0]?.hand?.length, deal: s.dealSignal };
});
console.log('重开后:', JSON.stringify(st));
console.log('错误:', errs.length ? errs.slice(0,2) : '无');
await b.close();
