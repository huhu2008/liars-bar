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

// 第一局：打到终局
let rounds = 0, lastRound = 0;
for (let i = 0; i < 12000; i++) {
  const s = await p.evaluate(() => {
    const st = window.__STORE__.getState();
    return { phase: st.game?.phase, round: st.game?.round };
  });
  if (s.round !== lastRound) { rounds = s.round; lastRound = s.round; }
  if (s.phase === 'game_end') break;
  await p.waitForTimeout(110);
}
await p.waitForTimeout(20000);
const end1 = await p.evaluate(() => ({
  panel: document.body.innerText.includes('再来一局'),
  snd: [...new Set((window.__SND__ || []).map(s => s.name))],
}));
console.log(`第一局: ${rounds} 轮, ${((Date.now()-t0)/1000).toFixed(0)}s, 终局面板=${end1.panel ? '✅' : '❌'}`);
console.log(`  音效: ${end1.snd.join(', ')}`);

// 点「再来一局」
const t1 = Date.now();
await p.getByRole('button', { name: /再来一局/ }).click();
await p.waitForTimeout(2500);
const after = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  return { phase: st.game?.phase, round: st.game?.round, hand: st.game?.players?.[0]?.hand?.length,
           bullets: st.game?.bullets, alive: st.game?.players?.filter(x=>x.alive).length, screen: st.screen };
});
console.log(`再来一局: ${JSON.stringify(after)}`);

// 第二局跑 40 秒确认能继续推进
const r0 = after.round;
await p.waitForTimeout(40000);
const later = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  return { round: st.game?.round, phase: st.game?.phase, alive: st.game?.players?.filter(x=>x.alive).length };
});
console.log(`第二局 40s 后: round ${r0} → ${later.round}, phase=${later.phase}, alive=${later.alive}`);
console.log(`控制台错误: ${errs.length ? '❌ ' + errs.slice(0,2).join(' | ') : '✅ 无'}`);
await b.close();
