import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5183/?turn=800', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);

console.log('时间   堆内存   DOM节点  音效数  轮次  阶段');
for (let i = 0; i < 12; i++) {
  await p.waitForTimeout(30000);
  const s = await p.evaluate(() => {
    const st = window.__STORE__.getState();
    return {
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      nodes: document.getElementsByTagName('*').length,
      snd: (window.__SND__ || []).length,
      round: st.game?.round,
      phase: st.game?.phase,
    };
  });
  console.log(`${((i+1)*30).toString().padStart(4)}s  ${String(s.heap).padStart(6)}MB  ${String(s.nodes).padStart(7)}  ${String(s.snd).padStart(6)}  ${String(s.round).padStart(4)}  ${s.phase}`);
  if (s.phase === 'game_end') {
    console.log('→ 到终局，重开继续压测');
    await p.getByRole('button', { name: /再来一局/ }).click().catch(() => {});
    await p.waitForTimeout(1500);
  }
}
console.log('错误:', errs.length ? errs.slice(0,3) : '无');
await b.close();
