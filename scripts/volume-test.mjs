import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3500);
// 音量控件现在在「设置」面板里
const gear = await p.$('button[aria-label="设置"]');
console.log('设置入口:', gear ? '✅' : '❌');
if (gear) {
  await gear.click();
  await p.waitForTimeout(350);
  const slider = await p.$('#settings-volume');
  console.log('面板内滑块:', slider ? '✅' : '❌');
  const before = await p.evaluate(() => window.__STORE__.getState().volume);
  await p.evaluate(() => {
    const el = document.querySelector('#settings-volume');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '30');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__STORE__.getState().volume);
  console.log(`音量 ${before} → ${after}`, after === 0.3 ? '✅' : '❌');
  const saved = await p.evaluate(() => localStorage.getItem('liars-bar:volume'));
  console.log('已保存:', saved, saved === '0.3' ? '✅' : '❌');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const restored = await p.evaluate(() => window.__STORE__.getState().volume);
  console.log('刷新后:', restored, restored === 0.3 ? '✅ 持久化' : '❌');
}
await b.close();
