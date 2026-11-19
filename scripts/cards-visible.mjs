import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));

const handCount = () => p.evaluate(() => document.querySelectorAll('[data-testid="hand-card"]').length);
const revealAt = () => p.evaluate(() => window.__STORE__.getState().revealAt);

async function enter(label) {
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  await p.waitForTimeout(4200);
  const n = await handCount();
  const r = await revealAt();
  console.log(`${label}: 手牌 ${n} 张, revealAt=${r === null ? 'null' : '有值'}`, n === 5 && r === null ? '✅' : '❌');
}

// ① 首次进入
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await enter('首次入座');

// ② 换角色 → 再入座
await p.getByRole('button', { name: /换角色/ }).click();
await p.waitForTimeout(1800);
await enter('换角色后再入座');

// ③ 重开
await p.getByRole('button', { name: /重开/ }).click();
await p.waitForTimeout(4200);
const n3 = await handCount(); const r3 = await revealAt();
console.log('重开后: 手牌', n3, '张, revealAt=', r3 === null ? 'null' : '有值', n3 === 5 && r3 === null ? '✅' : '❌');

console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
