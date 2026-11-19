import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 等到我的回合
for (let i = 0; i < 400; i++) {
  const t = await p.evaluate(() => {
    const s = window.__STORE__.getState();
    return s.game.turnSeat === 0 && !s.inputLocked;
  });
  if (t) break;
  await p.waitForTimeout(100);
}
// 打开设置面板
await p.evaluate(() => {
  const btn = document.querySelector('button[aria-label="设置"]');
  btn?.click();
});
await p.waitForTimeout(500);
const hasPanel = await p.evaluate(() => !!document.querySelector('[role="dialog"]'));
console.log('设置面板已打开:', hasPanel ? '✅' : '❌');

const before = await p.evaluate(() => ({
  sel: window.__STORE__.getState().selected.length,
  hand: window.__STORE__.getState().game.players[0].hand.length,
}));
// 面板打开时按 1、C、Enter
await p.keyboard.press('1');
await p.keyboard.press('c');
await p.keyboard.press('Enter');
await p.waitForTimeout(600);
const after = await p.evaluate(() => ({
  sel: window.__STORE__.getState().selected.length,
  hand: window.__STORE__.getState().game.players[0].hand.length,
  pending: !!window.__STORE__.getState().game.pendingPlay,
}));
console.log('操作前:', JSON.stringify(before));
console.log('操作后:', JSON.stringify(after));
const leaked = after.sel !== before.sel || after.hand !== before.hand;
console.log('面板打开时键盘是否漏到游戏:', leaked ? '❌ 漏了（会误操作）' : '✅ 被挡住');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
