import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=600', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 跨两轮观察收牌是否稳定出现
const rounds = [];
for (let i = 0; i < 3000; i++) {
  const r = await p.evaluate(() => window.__STORE__.getState().game?.round ?? 0);
  if (rounds[rounds.length - 1] !== r) rounds.push(r);
  if (rounds.length >= 3) break;
  await p.waitForTimeout(120);
}
console.log('推进轮次:', rounds.join(' → '));
console.log('推进正常:', rounds.length >= 2 ? '✅' : '❌');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
