import { chromium } from 'playwright-core';
const b = await chromium.connectOverCDP('http://127.0.0.1:9231');
const p = b.contexts()[0].pages().filter(x => !x.url().startsWith('devtools'))[0];
if (!p) { console.log('无页面'); process.exit(1); }
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
await p.waitForTimeout(5000);
const info = await p.evaluate(() => ({
  root: document.getElementById('root')?.innerHTML.length,
  chars: ['狐','鸦','猪','猫','法','浪'].filter(g => document.body.innerText.includes(g)),
  canvas: !!document.querySelector('canvas'),
}));
await p.screenshot({ path: '/tmp/el-fixed.png' });
console.log('Electron → root:', info.root, '| 角色:', info.chars.join(' '), '| canvas:', info.canvas);
console.log('错误:', errs.length ? errs.slice(0,2) : '无');
await b.close();
