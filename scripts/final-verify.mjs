import { chromium } from 'playwright-core';

const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

const t0 = Date.now();
await p.goto('http://localhost:5183/?turn=300', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);

let rounds = 0, deaths = 0, lastRound = 0, lastAlive = 4;
let end = false;
for (let i = 0; i < 12000; i++) {
  const s = await p.evaluate(() => {
    const st = window.__STORE__.getState();
    return { phase: st.game?.phase, round: st.game?.round, alive: st.game?.players?.filter(x => x.alive).length };
  });
  if (s.round !== lastRound) { rounds = s.round; lastRound = s.round; }
  if (s.alive < lastAlive) { deaths = 4 - s.alive; lastAlive = s.alive; }
  if (s.phase === 'game_end') { end = true; break; }
  await p.waitForTimeout(110);
}

// 等演出彻底结束（事件链 + 面板）
await p.waitForTimeout(24000);

const report = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  const snd = (window.__SND__ || []).map(s => s.name);
  const counts = snd.reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {});
  return {
    phase: st.game?.phase,
    winner: st.game?.winnerSeat,
    bullets: st.game?.bullets,
    panelShown: document.body.innerText.includes('再来一局'),
    sounds: counts,
    voices: (window.__VOICE__ || []).length,
  };
});

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log('=== 端到端验证 ===');
console.log(`时长          ${secs}s`);
console.log(`轮次          ${rounds}`);
console.log(`出局人数      ${deaths}`);
console.log(`终局 phase    ${report.phase}  赢家 seat=${report.winner}`);
console.log(`终局面板      ${report.panelShown ? '✅ 显示' : '❌ 未显示'}`);
console.log(`音效种类      ${Object.keys(report.sounds).join(', ')}`);
console.log(`语音播报      ${report.voices} 条`);
console.log(`控制台错误    ${errs.length ? '❌ ' + errs.slice(0,3).join(' | ') : '✅ 无'}`);
console.log(`到达终局      ${end ? '✅' : '❌ 超时'}`);

await p.screenshot({ path: '/tmp/final.png' });
await b.close();
