import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
await p.getByText('老法师·奥登').click();
await p.waitForTimeout(4000);
console.log('模型缩放调试:', JSON.stringify(await p.evaluate(() => window.__MODELDBG__)));
await b.close();
