import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1300);
await p.getByRole('button', { name: /原声集/ }).first().click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /DISC 2/ }).click();
await p.waitForTimeout(900);
await p.screenshot({ path: '/tmp/disc2.png' });
const info = await p.evaluate(() => {
  const d = document.querySelector('[aria-label="原声集 曲目列表"]');
  const all = [...d.querySelectorAll('button')].map(x => (x.textContent || '').trim().slice(0, 24));
  return { total: all.length, sample: all.slice(0, 8) };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
