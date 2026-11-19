import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(4000);

// ① 快速连点出牌按钮 20 次
for (let i = 0; i < 20; i++) {
  await p.getByRole('button', { name: /出牌/ }).click().catch(() => {});
}
await p.waitForTimeout(1500);
const s1 = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  return { hand: st.game.players[0].hand.length, phase: st.game.phase, err: st.error };
});
console.log('连点出牌 20 次:', JSON.stringify(s1));

// ② 快速切换重开 5 次
for (let i = 0; i < 5; i++) {
  await p.getByRole('button', { name: /重开/ }).click().catch(() => {});
  await p.waitForTimeout(120);
}
await p.waitForTimeout(4000);
const s2 = await p.evaluate(() => ({
  round: window.__STORE__.getState().game?.round,
  hand: window.__STORE__.getState().game?.players?.[0]?.hand?.length,
  cards: document.querySelectorAll('[data-testid="hand-card"]').length,
}));
console.log('连点重开 5 次:', JSON.stringify(s2), s2.cards === 5 ? '✅' : '❌');

// ③ 音量来回拖动 15 次
for (let i = 0; i < 15; i++) {
  await p.evaluate((v) => {
    const el = document.querySelector('#settings-volume') ?? document.querySelector('input[type=range]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, (i * 7) % 100);
}
await p.waitForTimeout(800);
const vol = await p.evaluate(() => window.__STORE__.getState().volume);
console.log('音量连拖 15 次后:', vol, typeof vol === 'number' && vol >= 0 && vol <= 1 ? '✅' : '❌');

// ④ 窗口尺寸剧烈变化
for (const [w, h] of [[390,844],[1280,820],[320,568],[768,1024],[1280,820]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(220);
}
const s4 = await p.evaluate(() => ({
  cards: document.querySelectorAll('[data-testid="hand-card"]').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
}));
console.log('尺寸变 5 次后:', JSON.stringify(s4), s4.cards > 0 ? '✅' : '❌');

console.log('错误数:', errs.length, errs.slice(0, 2));
await b.close();
