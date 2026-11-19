import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5183/?turn=600', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForTimeout(60000);
const r = await p.evaluate(() => {
  const ac = window.__AUDIO_CTX__;
  return { hasCtx: !!ac, state: ac?.state ?? 'none' };
});
console.log('AudioContext:', JSON.stringify(r));
console.log('错误:', errs.length ? errs.slice(0,3) : '无');
await b.close();
