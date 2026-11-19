import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
p.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 120)}`));
p.on('pageerror', e => logs.push('ERR: ' + e.message));
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.getByText('老法师·奥登').click();
await p.waitForTimeout(15000);
await p.screenshot({ path: '/tmp/prev-full.png' });
const info = await p.evaluate(() => {
  const c = document.querySelector('aside canvas');
  return { hasCanvas: !!c, w: c?.width, h: c?.height };
});
console.log('预览 canvas:', JSON.stringify(info));
console.log('日志:', logs.slice(0, 5));
await b.close();
