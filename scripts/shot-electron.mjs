import { chromium } from 'playwright-core';
const b = await chromium.connectOverCDP('http://127.0.0.1:9224');
const ctx = b.contexts()[0];
const pages = ctx.pages().filter(p => !p.url().startsWith('devtools'));
const p = pages[0];
if (!p) { console.log('没有页面'); process.exit(1); }
await p.waitForTimeout(4000);
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const info = await p.evaluate(() => ({
  title: document.title,
  text: document.body.innerText.slice(0, 120),
  chars: ['狐','鸦','猪','猫','法','浪'].filter(g => document.body.innerText.includes(g)),
  canvas: !!document.querySelector('canvas'),
}));
await p.screenshot({ path: '/tmp/electron-app.png' });
console.log('标题:', info.title);
console.log('角色:', info.chars.join(' '));
console.log('Canvas:', info.canvas);
console.log('文本:', info.text.replace(/\n/g, ' | ').slice(0, 80));
console.log('错误:', errs.length ? errs.slice(0,2) : '无');
await b.close();
