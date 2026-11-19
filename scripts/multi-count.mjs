import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
for (const count of [2, 3]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:5183/?turn=120', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: new RegExp(`^${count}$`) }).first().click();
  await p.waitForTimeout(250);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  let rounds = 0, lastRound = 0, ended = false;
  for (let i = 0; i < 12000; i++) {
    const st = await p.evaluate(() => {
      const s = window.__STORE__.getState();
      return { round: s.game?.round ?? 0, phase: s.game?.phase, players: s.game?.players?.length };
    });
    if (st.round !== lastRound) { rounds++; lastRound = st.round; }
    if (st.phase === 'game_end') { ended = true; break; }
    await p.waitForTimeout(60);
  }
  console.log(`${count} 人局: ${rounds} 轮, 到达终局=${ended ? '✅' : '❌'}, 玩家数=${await p.evaluate(() => window.__STORE__.getState().game.players.length)}, 错误=${errs.length ? errs[0] : '无'}`);
  await p.close();
}
await b.close();
