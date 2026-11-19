// 触摸拖动转视角：用真实 touch 事件（不是 mouse）验证 pointerdown/move/up 链路
import { chromium } from 'playwright-core';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: EXEC, headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForFunction(() => !!window.__HAND__?.length, null, { timeout: 20000 });
await p.waitForTimeout(5200);

const before = await p.screenshot();
const cdp = await ctx.newCDPSession(p);
const y = 430;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
for (let i = 1; i <= 12; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 12, y }] });
  await p.waitForTimeout(16);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await p.waitForTimeout(900);
const after = await p.screenshot({ path: '/tmp/drag-390x844.png' });
await b.close();

// 粗糙的差异度：两帧 png 压缩后的字节差 + 逐像素比较（用 canvas 太重，这里只比字节）
const diff = Math.abs(before.length - after.length);
console.log(JSON.stringify({ beforeBytes: before.length, afterBytes: after.length, byteDelta: diff, changed: diff > 2000 }));
