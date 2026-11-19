import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));

const FIELDS = ['revealAt','shotSeat','tenseSeat','selected','inputLocked','collectHand'];
// 只检查「跨局/跨界面会残留」的字段；deadline 和 speakingSeat 是正常运行时状态
const CLEAN = { revealAt: null, shotSeat: null, tenseSeat: null, selected: [], inputLocked: false, collectHand: 0 };

const snap = () => p.evaluate((fields) => {
  const st = window.__STORE__.getState();
  const o = {};
  fields.forEach(f => { o[f] = Array.isArray(st[f]) ? st[f].length : st[f]; });
  o.hand = document.querySelectorAll('[data-testid="hand-card"]').length;
  o.phase = st.game?.phase;
  return o;
}, FIELDS);

function check(label, s) {
  const bad = Object.entries(CLEAN).filter(([k, v]) => {
    const got = s[k];
    if (Array.isArray(v)) return got !== 0;
    if (typeof v === 'boolean') return got !== v && s.phase === 'turn';
    return got !== v && s.phase === 'turn';
  });
  const ok = bad.length === 0 && s.hand > 0;
  console.log(`${ok ? '✅' : '❌'} ${label}: 手牌 ${s.hand}, phase=${s.phase}` + (bad.length ? ` | 残留: ${bad.map(([k]) => k).join(',')}` : ''));
  return ok;
}

// ① 首次入座
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas'); await p.waitForTimeout(4500);
const r1 = check('首次入座', await snap());

// ② 换角色 → 入座
await p.getByRole('button', { name: /换角色/ }).click();
await p.waitForTimeout(1800);
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForTimeout(4500);
const r2 = check('换角色后入座', await snap());

// ③ 重开
await p.getByRole('button', { name: /重开/ }).click();
await p.waitForTimeout(4500);
const r3 = check('重开后', await snap());

console.log('\n结果:', [r1, r2, r3].every(Boolean) ? '全部干净 ✅' : '有问题 ❌');
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
