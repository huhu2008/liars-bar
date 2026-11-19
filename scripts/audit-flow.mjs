/** 流程类排查：人数、设置、重开、换角色、语音开关 */
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5183';
const res = [];
const ok = (n, d = '') => res.push({ n, pass: true, d });
const bad = (n, d = '') => res.push({ n, pass: false, d });

const b = await chromium.launch({ executablePath: CHROME, headless: true });

async function page() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
  p.on('response', r => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url().split('/').pop()}`); });
  return { p, ctx, errs };
}

/* 2 / 3 / 4 人局 */
for (const n of [2, 3, 4]) {
  const { p, ctx, errs } = await page();
  await p.goto(BASE + '/?turn=60000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: new RegExp(`^${n}$`) }).first().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  await p.waitForTimeout(8000);
  const seats = await p.evaluate(() => window.__STORE__.getState().game.players.length);
  seats === n ? ok(`${n} 人局`, `实际 ${seats} 人`) : bad(`${n} 人局`, `应为 ${n}，实际 ${seats}`);
  if (errs.length) bad(`${n} 人局错误`, errs[0]);
  await ctx.close();
}

/* 设置面板 */
{
  const { p, ctx, errs } = await page();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: /^设置$/ }).first().click();
  await p.waitForTimeout(600);
  const txt = await p.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '');
  const hasVol = txt.includes('音量');
  const hasVoice = txt.includes('语音');
  hasVol && hasVoice ? ok('设置面板', '音量+语音都在') : bad('设置面板', `音量=${hasVol} 语音=${hasVoice}`);
  // 拖动音量
  const slider = await p.locator('input[type=range]').first();
  if (await slider.count()) {
    // 用浏览器原生方向键调整滑块，验证状态实际写入。
    await slider.focus();
    await slider.press('Home');
    for (let i = 0; i < 9; i++) await slider.press('ArrowRight');
    await p.waitForTimeout(400);
    const volume = await p.evaluate(() => window.__STORE__.getState().volume);
    if (volume === 0.45) ok('音量可调整');
    else bad('音量可调整', String(volume));
  } else bad('音量可调整', '找不到滑块');
  if (errs.length) bad('设置面板错误', errs[0]);
  await ctx.close();
}

/* 重开 + 换角色 */
{
  const { p, ctx, errs } = await page();
  await p.goto(BASE + '/?turn=60000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  await p.waitForTimeout(8000);

  const before = await p.evaluate(() => window.__STORE__.getState().game.round);
  await p.getByRole('button', { name: /重开/ }).first().click();
  await p.waitForTimeout(4000);
  const afterRestart = await p.evaluate(() => {
    const s = window.__STORE__.getState();
    return { round: s.game.round, phase: s.game.phase, chars: s.characters.length };
  });
  afterRestart.round <= 1 ? ok('重开生效', `round ${afterRestart.round}`) : bad('重开生效', `round 还是 ${afterRestart.round}`);

  await p.getByRole('button', { name: /换角色/ }).first().click();
  await p.waitForTimeout(2500);
  // 直接检查选角控件，避免旧版首页文案造成误报。
  const onSelect = await p.locator('button.roster-card:visible').count() === 6;
  onSelect ? ok('换角色回到选角') : bad('换角色回到选角');
  if (errs.length) bad('重开/换角色错误', errs[0]);
  await ctx.close();
}

await b.close();
const pass = res.filter(r => r.pass).length;
console.log('\n=== 流程排查 ===');
for (const r of res) console.log(`${r.pass ? '✅' : '❌'} ${r.n}${r.d ? '  —  ' + r.d : ''}`);
console.log(`\n通过 ${pass} / ${res.length}`);
if (pass < res.length) process.exit(1);
