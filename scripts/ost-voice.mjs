import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1300);
await p.getByRole('button', { name: /原声集/ }).first().click();
await p.waitForTimeout(900);

// 点 DISC 2
const d2 = await p.getByRole('button', { name: /DISC 2/ }).count();
console.log('DISC 2 按钮存在:', d2 > 0 ? '✅' : '❌');
if (d2 > 0) {
  await p.getByRole('button', { name: /DISC 2/ }).click();
  await p.waitForTimeout(700);
  const rows = await p.evaluate(() => {
    const d = document.querySelector('[aria-label="原声集 曲目列表"]');
    return [...d.querySelectorAll('button')].filter(x => /^\d/.test((x.textContent || '').trim())).length;
  });
  console.log('DISC 2 曲目数:', rows, rows > 0 ? '✅' : '❌');
  // 点第一条
  await p.evaluate(() => {
    const d = document.querySelector('[aria-label="原声集 曲目列表"]');
    const b = [...d.querySelectorAll('button')].find(x => /^\d/.test((x.textContent || '').trim()));
    b?.click();
  });
  await p.waitForTimeout(900);
  const playing = await p.evaluate(() => (document.querySelector('[aria-label="原声集 曲目列表"]')?.innerText ?? '').includes('❚❚'));
  console.log('播放态:', playing ? '✅' : '⚠️ 可能已播完');
}
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
