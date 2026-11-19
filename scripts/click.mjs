import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=20000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3500);

// 找到 DOM 命中层上的手牌点
const pts = await p.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-testid="hand-card"]')];
  return nodes.map(n => {
    const r = n.getBoundingClientRect();
    return { i: n.getAttribute('data-card'), x: r.x + r.width/2, y: r.y + r.height/2 };
  });
});
console.log('命中点数量:', pts.length, pts.slice(0,3));

let ok = 0;
for (const pt of pts.slice(0, 3)) {
  await p.mouse.click(pt.x, pt.y);
  await p.waitForTimeout(250);
  const sel = await p.evaluate(() => window.__STORE__.getState().selected.length);
  if (sel > ok) ok = sel;
}
console.log('点击后选中张数:', ok);
await p.screenshot({ path: '/tmp/click.png' });
await b.close();
