import { chromium } from 'playwright-core';
// 连到 Electron 的调试端口
const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null);
if (!b) { console.log('未开启 CDP，跳过'); process.exit(0); }
const ctx = b.contexts()[0];
const p = ctx?.pages()[0];
if (!p) { console.log('没有页面'); process.exit(0); }
await p.waitForTimeout(3000);
const title = await p.title();
const chars = await p.evaluate(() => ['狐','鸦','猪','猫','法','浪'].filter(g => document.body.innerText.includes(g)));
await p.screenshot({ path: '/tmp/electron-shot.png' });
console.log('标题:', title);
console.log('角色:', chars.join(' '));
await b.close();
