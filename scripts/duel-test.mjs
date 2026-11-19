import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=200', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 打到只剩 2 人
for (let i = 0; i < 6000; i++) {
  const alive = await p.evaluate(() => window.__STORE__.getState().game?.players?.filter(x => x.alive).length);
  if (alive === 2) break;
  await p.waitForTimeout(150);
}
await p.waitForTimeout(12000);
const v = await p.evaluate(() => (window.__VOICE__ || []).map(x => x.text));
const duel = v.filter(t => /就剩我们俩|桌子清空|两个人.*一把枪|没人能替你|就咱俩|不想跟你抢|只剩你和我|很好猜的/.test(t));
console.log('对峙台词:', duel.length, duel);
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
