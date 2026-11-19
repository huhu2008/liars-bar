import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=4000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3000);
// 构造：让 seat 1 手牌只剩 1 张 + 前科 2 次
await p.evaluate(() => {
  const st = window.__STORE__.getState();
  const g = structuredClone(st.game);
  const hand = g.players[1].hand;
  g.players[1].hand = [hand[0]];
  g.liesBySeat[1] = 2;
  window.__STORE__.setState({ game: g });
});
// 等 seat 1 出牌
const seen = [];
for (let i = 0; i < 900; i++) {
  const v = await p.evaluate(() => (window.__VOICE__ || []).map(x => ({ t: x.text, src: x.src })));
  for (const x of v) {
    if (!seen.find(s => s.t === x.t)) seen.push(x);
  }
  const hits = seen.filter(s => /最后一张|就剩这一张|就剩它了|又盯上我|太显眼|记住我|记性太好|咋老被|又是俺|老是我|针对我/.test(s.t));
  if (hits.length >= 1) break;
  await p.waitForTimeout(120);
}
const situational = seen.filter(s => /最后一张|就剩这一张|就剩它了|又盯上我|太显眼|记住我|记性太好|咋老被|又是俺|老是我|针对我/.test(s.t));
console.log('触发的场景台词:', situational.length);
situational.forEach(s => console.log('  「' + s.t + '」  ←  ' + (s.src || '').split('/').pop()));
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
