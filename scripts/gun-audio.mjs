import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=200', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.evaluate(() => { window.__SND__ = []; });
// 打到有人被罚 3 次，记录每次的音效与真实结果
const records = [];
for (let i = 0; i < 20000; i++) {
  const st = await p.evaluate(() => {
    const s = window.__STORE__.getState();
    const r = s.game?.lastReveal;
    return {
      shot: s.shotSeat,
      died: r?.died,
      punished: r?.punishedSeat,
      phase: s.game?.phase,
      snd: (window.__SND__ || []).filter(x => x.name.startsWith('gun')).map(x => x.name),
    };
  });
  if (st.shot !== null && st.snd.length > 0) {
    const key = st.shot + ':' + st.snd.join(',');
    if (!records.find(r => r.key === key)) {
      records.push({ key, shot: st.shot, died: st.died, snd: st.snd.join(',') });
      await p.evaluate(() => { window.__SND__ = []; });
    }
  }
  if (records.length >= 4) break;
  await p.waitForTimeout(80);
}
records.forEach(r => console.log(`shotSeat=${r.shot} died=${r.died} → 播放: ${r.snd}`));
await b.close();
