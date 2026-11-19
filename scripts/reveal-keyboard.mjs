import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=200', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 等到结算面板出现
let shown = false;
for (let i = 0; i < 6000; i++) {
  const has = await p.evaluate(() => !!document.querySelector('[role="dialog"]'));
  if (has) { shown = true; break; }
  await p.waitForTimeout(80);
}
console.log('结算面板出现:', shown ? '✅' : '⚠️ 没等到');
if (shown) {
  const before = await p.evaluate(() => ({ hand: window.__STORE__.getState().game.players[0].hand.length, phase: window.__STORE__.getState().game.phase }));
  await p.keyboard.press('1');
  await p.keyboard.press('c');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({ hand: window.__STORE__.getState().game.players[0].hand.length, phase: window.__STORE__.getState().game.phase }));
  console.log('键盘操作前后:', JSON.stringify(before), '→', JSON.stringify(after));
  console.log('面板期间键盘被挡:', before.hand === after.hand && before.phase === after.phase ? '✅' : '❌');
}
await b.close();
