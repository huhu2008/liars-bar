import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=5000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(6000);
// 数字键选牌
await p.keyboard.press('1');
await p.waitForTimeout(200);
await p.keyboard.press('2');
await p.waitForTimeout(200);
const sel = await p.evaluate(() => window.__STORE__.getState().selected.length);
console.log('键盘选中:', sel, sel === 2 ? '✅' : '❌');
// Esc 取消
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
const after = await p.evaluate(() => window.__STORE__.getState().selected.length);
console.log('Esc 取消:', after, after === 0 ? '✅' : '❌');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
