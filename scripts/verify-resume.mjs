import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
const p = await ctx.newPage();
// 开一局，玩两步让存档写入
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(12000);
const before = await p.evaluate(() => window.__STORE__.getState().game.players.map(x => x.name));
// 刷新页面（触发 resumeSaved）
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const hasResume = await p.getByRole('button', { name: /接着打/ }).count();
if (hasResume) {
  await p.getByRole('button', { name: /接着打/ }).first().click();
  await p.waitForTimeout(6000);
}
const after = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  return {
    players: st.game.players.map(x => x.name),
    chars: st.characters.map(c => c.name),
    match: st.game.players.every((pl, i) => st.characters[i]?.name === pl.name),
  };
});
console.log('开局前:', before.join(' | '));
console.log('恢复后:', after.players.join(' | '));
console.log('恢复后角色:', after.chars.join(' | '));
console.log('恢复座位匹配:', after.match ? '✅' : '❌ 错位');
await b.close();
