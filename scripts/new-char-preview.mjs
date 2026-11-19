import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
// 点「法」
await p.getByText('老法师·奥登').click();
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/mage.png', clip: { x: 860, y: 130, width: 340, height: 320 } });
console.log('点法师后错误:', errs.length ? errs.slice(0,2) : '无');
// 点「浪」
await p.getByText('浪人·希拉').click();
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/rogue.png', clip: { x: 860, y: 130, width: 340, height: 320 } });
console.log('点浪人后错误:', errs.length ? errs.slice(0,2) : '无');
await b.close();
