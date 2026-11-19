import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(5000);
// 直接调用 nextRound（模拟玩家点「继续下一轮」）
const before = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  // 强制进入 round_end 以便 nextRound 生效
  return { collect: st.collectHand, deal: st.dealSignal, phase: st.game.phase };
});
await p.evaluate(() => { window.__STORE__.setState({ game: { ...window.__STORE__.getState().game, phase: 'round_end' } }); });
await p.evaluate(() => window.__STORE__.getState().nextRound());
await p.waitForTimeout(1500);
const after = await p.evaluate(() => {
  const st = window.__STORE__.getState();
  return { collect: st.collectHand, deal: st.dealSignal, phase: st.game.phase };
});
console.log('调用前:', JSON.stringify(before));
console.log('调用后:', JSON.stringify(after));
console.log('收牌信号 +1:', after.collect === before.collect + 1 ? '✅' : `❌ ${before.collect}→${after.collect}`);
await p.waitForTimeout(4000);
const final = await p.evaluate(() => window.__STORE__.getState().dealSignal);
console.log('发牌信号 +1:', final === before.deal + 1 ? '✅' : `❌ ${before.deal}→${final}`);
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
