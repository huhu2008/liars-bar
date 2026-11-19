import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const reqs = [], errs = [];
p.on('response', r => { if (/mage\.glb|draco/.test(r.url())) reqs.push(`${r.status()} ${r.url().split('/').pop()}`); });
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 等到有法师的局
for (let i = 0; i < 6; i++) {
  const seats = await p.evaluate(() => window.__STORE__.getState().game.players.map(x => x.name));
  if (seats.some(n => n.includes('法师'))) break;
  await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
}
await p.waitForTimeout(10000);
console.log('mage/draco 请求:', reqs);
console.log('错误:', errs.slice(0, 3));
await b.close();
