import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5183/?turn=20000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3500);

// 一次性连点「出牌」10 次（中间不留间隔）
const pts = await p.evaluate(() => {
  const n = document.querySelector('[data-testid="hand-card"]');
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await p.mouse.click(pts.x, pts.y);
await p.waitForTimeout(200);

const before = await p.evaluate(() => {
  const s = window.__STORE__.getState();
  return { hand: s.game.players[0].hand.length, selected: s.selected.length, err: s.error };
});
const btn = await p.getByRole('button', { name: /^出牌/ }).boundingBox();
for (let i = 0; i < 10; i++) {
  await p.mouse.click(btn.x + btn.width / 2, btn.y + btn.height / 2);
}
await p.waitForTimeout(900);
const after = await p.evaluate(() => {
  const s = window.__STORE__.getState();
  return { hand: s.game.players[0].hand.length, pending: !!s.game.pendingPlay, err: s.error, phase: s.game.phase };
});
console.log('连点前:', JSON.stringify(before));
console.log('连点后:', JSON.stringify(after));
console.log('手牌减少:', before.hand - after.hand, '张（应 ≤ 3）');
console.log('错误:', errs.length ? errs.slice(0,2) : '无');
await b.close();
