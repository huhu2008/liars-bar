import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// 玩家选狐狸，让法师有机会作为对手
await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
await p.waitForTimeout(600);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(12000);
const seats = await p.evaluate(() => {
  const g = window.__STORE__.getState().game;
  return g.players.map(x => `${x.seat}:${x.name}`);
});
console.log('座位:', seats.join(' | '));
await p.screenshot({ path: '/tmp/mage-opp.png' });
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
