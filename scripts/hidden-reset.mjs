import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(4500);

// 手动把 handHidden 置 true（模拟收牌窗口），然后立即重开
await p.evaluate(() => window.__STORE__.setState({ handHidden: true }));
await p.waitForTimeout(200);
const before = await p.evaluate(() => ({
  hidden: window.__STORE__.getState().handHidden,
  cards: document.querySelectorAll('[data-testid="hand-card"]').length,
}));
console.log('人为隐藏后:', JSON.stringify(before), before.hidden && before.cards === 0 ? '✅ 已隐藏' : '❌');

await p.getByRole('button', { name: /重开/ }).click();
await p.waitForTimeout(4500);
const after = await p.evaluate(() => ({
  hidden: window.__STORE__.getState().handHidden,
  cards: document.querySelectorAll('[data-testid="hand-card"]').length,
}));
console.log('重开后:', JSON.stringify(after));
console.log('已自动恢复:', !after.hidden && after.cards > 0 ? '✅ 原子重置生效' : '❌ 仍隐藏');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
