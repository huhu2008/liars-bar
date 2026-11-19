import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const names = await p.evaluate(() => {
  const t = document.body.innerText;
  return ['狐', '鸦', '猪', '猫', '法', '浪'].filter(g => t.includes(g));
});
console.log('选角页角色数:', names.length, names.join(' '));
await p.screenshot({ path: '/tmp/six.png' });
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
