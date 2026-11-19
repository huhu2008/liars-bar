import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));

// 造一个 round_end 状态的存档（最容易触发残留的路径）
await p.addInitScript(() => {
  const mk = () => ({
    seat: 0, round: 3, phase: 'round_end', targetRank: 'K', tableCard: null,
    players: [
      { seat: 0, name: '你', hand: [{id:'KH',rank:'K',suit:'H'}], alive: true, isBot: false },
      { seat: 1, name: '狡狐', hand: [{id:'AH',rank:'A',suit:'H'}], alive: true, isBot: true },
      { seat: 2, name: '鸦先生', hand: [], alive: false, isBot: true },
      { seat: 3, name: '屠夫', hand: [], alive: false, isBot: true },
    ],
    turnSeat: 0, bullets: 2, deck: [], discard: [], publicCards: [], log: [],
    liesBySeat: [0,0,0,0], correctChallenges: [0,0,0,0],
    pendingPlay: null, lastReveal: null, winnerSeat: null, roundWinnerSeat: null,
  });
  localStorage.setItem('liars-bar:save', JSON.stringify({
    game: mk(), characterId: 'fox', playerCount: 4, at: Date.now(),
  }));
});

await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const btn = await p.getByRole('button', { name: /接着打这一局/ }).count();
console.log('继续按钮:', btn > 0 ? '✅' : '❌');
await p.getByRole('button', { name: /接着打这一局/ }).click();
await p.waitForSelector('canvas');
await p.waitForTimeout(5000);
const r = await p.evaluate(() => ({
  revealAt: window.__STORE__.getState().revealAt,
  hand: document.querySelectorAll('[data-testid="hand-card"]').length,
  phase: window.__STORE__.getState().game?.phase,
}));
console.log('恢复后:', JSON.stringify(r));
console.log('手牌可见:', r.hand > 0 ? '✅' : '❌');
// 等 10 秒，确认 revealAt 过期后手牌能回来
await p.waitForTimeout(10000);
const r2 = await p.evaluate(() => document.querySelectorAll('[data-testid="hand-card"]').length);
console.log('10 秒后手牌:', r2, r2 > 0 ? '✅ 已恢复' : '❌');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
