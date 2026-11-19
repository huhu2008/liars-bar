import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=20000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3500);
const pts = await p.evaluate(() => [...document.querySelectorAll('[data-testid="hand-card"]')].map(n => {
  const r = n.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };
}));
for (const pt of pts.slice(0, 2)) { await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(220); }
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/sel.png', clip: { x: 380, y: 380, width: 560, height: 400 } });
console.log('选中张数:', await p.evaluate(() => window.__STORE__.getState().selected.length));
await b.close();
