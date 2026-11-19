import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
for (let attempt = 0; attempt < 8; attempt++) {
  await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  await p.waitForTimeout(10000);
  const seats = await p.evaluate(() => window.__STORE__.getState().game.players.map(x => x.name));
  const hasMage = seats.some(n => n.includes('法师'));
  const hasRogue = seats.some(n => n.includes('浪人'));
  console.log(`第${attempt+1}局:`, seats.join(' | '), hasMage ? '← 有法师' : '', hasRogue ? '← 有浪人' : '');
  if (hasMage || hasRogue) {
    await p.screenshot({ path: '/tmp/new-char-seat.png' });
    break;
  }
}
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
