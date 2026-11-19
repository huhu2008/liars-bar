import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=3000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
// 打几手，等存档落盘
await p.waitForTimeout(18000);
const before = await p.evaluate(() => {
  const g = window.__STORE__.getState().game;
  const raw = localStorage.getItem('liars-bar:save');
  return { round: g.round, turn: g.turnSeat, phase: g.phase, hands: g.players.map(x=>x.hand.length), saved: !!raw };
});
console.log('刷新前:', JSON.stringify(before));
// 刷新
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const hasBtn = await p.getByRole('button', { name: /接着打这一局/ }).count();
console.log('选角页有「接着打这一局」:', hasBtn > 0 ? '✅' : '❌');
if (hasBtn > 0) {
  await p.getByRole('button', { name: /接着打这一局/ }).click();
  await p.waitForSelector('canvas');
  await p.waitForTimeout(2000);
  const after = await p.evaluate(() => {
    const g = window.__STORE__.getState().game;
    return { round: g.round, turn: g.turnSeat, phase: g.phase, hands: g.players.map(x=>x.hand.length) };
  });
  console.log('恢复后:', JSON.stringify(after));
  console.log('轮次一致:', before.round === after.round ? '✅' : '❌');
  console.log('手牌一致:', JSON.stringify(before.hands) === JSON.stringify(after.hands) ? '✅' : '❌');
}
await b.close();
