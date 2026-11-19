import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=200', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.evaluate(() => { window.__SND__ = []; window.__MARK__ = []; });
// 监听每次开枪，记录时间戳 + 音效名 + 结果
await p.evaluate(() => {
  window.__STORE__.subscribe((st, prev) => {
    if (st.shotSeat !== null && prev.shotSeat === null) {
      window.__MARK__.push({ t: Date.now(), event: 'shot-start', seat: st.shotSeat, died: st.game?.lastReveal?.died });
    }
  });
});
for (let i = 0; i < 20000; i++) {
  const n = await p.evaluate(() => window.__MARK__.length);
  if (n >= 3) break;
  await p.waitForTimeout(80);
}
await p.waitForTimeout(2000);
const r = await p.evaluate(() => ({
  marks: window.__MARK__,
  snd: (window.__SND__ || []).filter(x => x.name.startsWith('gun')),
}));
// 按时间配对：每次 shot-start 之后 1.5 秒内的枪声
r.marks.forEach(m => {
  const guns = r.snd.filter(s => s.at >= m.t && s.at <= m.t + 1500);
  console.log(`seat=${m.seat} died=${m.died} → ${guns.map(g => g.name).join(', ') || '（无）'}`);
});
await b.close();
