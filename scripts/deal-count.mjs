import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(5000);
// 开始计数
const start = () => p.evaluate(() => { window.__N__ = window.__STORE__.getState().dealSignal; });
const diff = () => p.evaluate(() => window.__STORE__.getState().dealSignal - window.__N__);

await start();
await p.getByRole('button', { name: /重开/ }).click();
await p.waitForTimeout(5000);
console.log('重开触发次数:', await diff(), (await diff()) === 1 ? '✅' : '❌');

await start();
await p.getByRole('button', { name: /换角色/ }).click();
await p.waitForTimeout(1800);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForTimeout(5000);
console.log('换角色入座触发次数:', await diff(), (await diff()) === 1 ? '✅' : '❌');
await b.close();
