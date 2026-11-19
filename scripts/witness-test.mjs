import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=300', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 打到有人死
let died = false;
for (let i = 0; i < 5000; i++) {
  const alive = await p.evaluate(() => window.__STORE__.getState().game?.players?.filter(x => x.alive).length);
  if (alive !== null && alive < 4) { died = true; break; }
  await p.waitForTimeout(150);
}
if (died) {
  await p.waitForTimeout(9000);
  const v = await p.evaluate(() => (window.__VOICE__ || []).map(x => x.text));
  const wit = v.filter(t => /下一个是谁|椅子又空|少了一个|位置会变冷|记下了.*空着|哎呀妈呀|这就没了|别看我|好可怕/.test(t));
  console.log('目睹台词:', wit.length, wit);
}
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
