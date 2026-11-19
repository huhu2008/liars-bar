import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const bad = [], errs = [];
p.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace('http://localhost:8899','')}`); });
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
// 子目录路径，模拟 itch.io
await p.goto('http://localhost:8899/html/12345/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const title = await p.evaluate(() => document.body.innerText.slice(0, 40).replace(/\s+/g, ' '));
console.log('页面内容:', title);
console.log('4xx/5xx 资源:', bad.length ? bad.slice(0, 5) : '无 ✅');
console.log('JS 错误:', errs.length ? errs.slice(0, 2) : '无 ✅');
await b.close();
