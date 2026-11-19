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

// ① AI 回合时尝试选牌（应该无效）
const aiTurn = await p.evaluate(() => window.__STORE__.getState().game.turnSeat);
if (aiTurn !== 0) {
  const before = await p.evaluate(() => window.__STORE__.getState().selected.length);
  await p.keyboard.press('1');
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => window.__STORE__.getState().selected.length);
  console.log(`AI 回合选牌: ${before} → ${after}`, after === 0 ? '✅ 被挡住' : '❌ 能选');
} else {
  console.log('AI 回合选牌: 跳过（正好轮到我）');
}

// ② 等我的回合，正常选牌
for (let i = 0; i < 300; i++) {
  const t = await p.evaluate(() => window.__STORE__.getState().game.turnSeat);
  const l = await p.evaluate(() => window.__STORE__.getState().inputLocked);
  if (t === 0 && !l) break;
  await p.waitForTimeout(100);
}
await p.keyboard.press('1');
await p.waitForTimeout(250);
const sel = await p.evaluate(() => window.__STORE__.getState().selected.length);
console.log('我的回合选牌:', sel, sel === 1 ? '✅' : '❌');

// ③ 出牌后立刻再尝试选牌（演出中，应该无效）
await p.getByRole('button', { name: /出牌/ }).click().catch(() => {});
await p.waitForTimeout(150);
const locked = await p.evaluate(() => window.__STORE__.getState().inputLocked);
await p.keyboard.press('2');
await p.waitForTimeout(200);
const sel2 = await p.evaluate(() => window.__STORE__.getState().selected.length);
console.log(`出牌后（locked=${locked}）选牌:`, sel2, sel2 === 0 ? '✅ 被挡住' : '❌ 能选');

console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
