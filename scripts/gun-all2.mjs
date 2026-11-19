import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = [];
for (const count of [2, 3, 4]) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
    await p.goto('http://localhost:5183/?turn=150', { waitUntil: 'networkidle' });
    await p.waitForTimeout(650);
    await p.getByRole('button', { name: new RegExp(`^${count}$`) }).first().click();
    await p.waitForTimeout(220);
    await p.getByRole('button', { name: /入座/ }).first().click();
    await p.waitForSelector('canvas');
    await p.waitForFunction(() => !!window.__STORE__);
    let seat = null;
    for (let i = 0; i < 9000; i++) {
      const s = await p.evaluate(() => window.__STORE__.getState().shotSeat);
      if (s !== null && s !== 0) { seat = s; break; }
      await p.waitForTimeout(45);
    }
    if (seat !== null) {
      // 连拍 5 帧，挑枪最清楚的
      for (let k = 0; k < 5; k++) { await p.screenshot({ path: `/tmp/ga-${count}p-s${seat}-${k}.png` }); await p.waitForTimeout(120); }
      out.push(`${count}p/s${seat}`);
      await p.close();
      break;
    }
    await p.close();
  }
}
console.log(out.join(' | '));
await b.close();
