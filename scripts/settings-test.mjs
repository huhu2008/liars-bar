import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));

// ① 选角页
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const selectBtn = await p.getByRole('button', { name: /^设置$/ }).count();
console.log('选角页有设置:', selectBtn > 0 ? '✅' : '❌');
await p.getByRole('button', { name: /^设置$/ }).first().click();
await p.waitForTimeout(400);
const dlg = await p.evaluate(() => document.querySelector('[role="dialog"]')?.innerText?.replace(/\n/g,' | ') ?? '');
console.log('面板内容:', dlg.slice(0, 60));
// 调音量
await p.evaluate(() => {
  const el = document.querySelector('#settings-volume');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '45');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(300);
const vol = await p.evaluate(() => window.__STORE__.getState().volume);
console.log('音量设为 45%:', vol === 0.45 ? '✅' : `❌ (${vol})`);
// 语音开关
await p.getByRole('switch', { name: /语音播报/ }).click();
await p.waitForTimeout(200);
const vOn = await p.evaluate(() => window.__STORE__.getState().voiceOn);
console.log('语音开关切换:', vOn === false ? '✅ 已关闭' : '❌');
await p.screenshot({ path: '/tmp/settings-select.png' });

// ② 牌桌
await p.keyboard.press('Escape');
  await p.evaluate(() => localStorage.removeItem('liars-bar:save'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForTimeout(4000);
const tableBtn = await p.getByRole('button', { name: /设置/ }).count();
console.log('牌桌有设置入口:', tableBtn > 0 ? '✅' : '❌');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
