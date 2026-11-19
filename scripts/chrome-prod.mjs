import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
await p.goto('http://localhost:5201/', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const info = await p.evaluate(() => ({
  root: document.getElementById('root')?.innerHTML.length,
  chars: ['狐','鸦','猪','猫','法','浪'].filter(g => document.body.innerText.includes(g)),
}));
console.log('Chrome 生产构建 → root:', info.root, '角色:', info.chars.join(' ') || '无');
console.log('错误:', errs.length ? errs.slice(0,2) : '无');
await b.close();
