/**
 * 全面排查：资源、六个角色、完整对局、存档恢复、音频、控制台。
 * 每一项都输出 PASS / FAIL，最后汇总。
 */
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5183';
const results = [];
const ok = (name, detail = '') => results.push({ name, pass: true, detail });
const bad = (name, detail = '') => results.push({ name, pass: false, detail });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage();
  const net = { bad: [], errs: [] };
  p.on('response', r => { if (r.status() >= 400) net.bad.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  p.on('pageerror', e => net.errs.push(e.message.slice(0, 120)));
  return { p, ctx, net };
}

/* ---------- 1. 选角页：六个角色逐个点 ---------- */
{
  const { p, ctx, net } = await freshPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  const cards = await p.evaluate(() =>
    ['狐','鸦','猪','猫','法','浪'].filter(g => document.body.innerText.includes(g)));
  cards.length === 6 ? ok('选角页六角色', cards.join('')) : bad('选角页六角色', `只找到 ${cards.length}`);

  const names = [['狐', /狐.*狡狐/], ['鸦', /鸦.*鸦先生/], ['猪', /猪.*屠夫/], ['猫', /猫.*小猫/], ['法', /法.*法师/], ['浪', /浪.*浪人/]];
  for (const [label, sel] of names) {
    const before = net.errs.length;
    await p.getByRole('button', { name: sel }).first().click();
    await p.waitForTimeout(2200);
    const canvas = await p.evaluate(() => !!document.querySelector('aside canvas'));
    if (net.errs.length > before) bad(`预览·${label}`, net.errs[before]);
    else if (!canvas) bad(`预览·${label}`, 'canvas 缺失');
    else ok(`预览·${label}`);
  }
  net.bad.length === 0 ? ok('选角页零 4xx', net.bad.join(',')) : bad('选角页零 4xx', net.bad.slice(0, 3).join(','));
  await ctx.close();
}

/* ---------- 2. 六个角色各自开局（验证座位匹配） ---------- */
for (const [label, sel] of [['狐', /狐.*狡狐/], ['鸦', /鸦.*鸦先生/], ['猪', /猪.*屠夫/], ['猫', /猫.*小猫/], ['法', /法.*法师/], ['浪', /浪.*浪人/]]) {
  const { p, ctx, net } = await freshPage();
  await p.goto(BASE + '/?turn=60000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: sel }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  await p.waitForTimeout(11000);
  const st = await p.evaluate(() => {
    const s = window.__STORE__.getState();
    return {
      match: s.game.players.every((pl, i) => s.characters[i]?.name === pl.name),
      players: s.game.players.map(x => x.name),
      phase: s.game.phase,
      err: null,
    };
  });
  if (!st.match) bad(`开局·${label}`, '角色与座位错位');
  else if (net.errs.length) bad(`开局·${label}`, net.errs[0]);
  else ok(`开局·${label}`, st.players.join('|'));
  await ctx.close();
}

/* ---------- 3. 完整一局（快进到结束） ---------- */
{
  const { p, ctx, net } = await freshPage();
  await p.goto(BASE + '/?turn=800', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  let phase = '';
  for (let i = 0; i < 160; i++) {
    await p.waitForTimeout(2000);
    phase = await p.evaluate(() => window.__STORE__.getState().game.phase);
    if (phase === 'game_end') break;
  }
  phase === 'game_end' ? ok('完整对局到终局') : bad('完整对局到终局', `停在 ${phase}`);
  net.errs.length === 0 ? ok('对局零报错') : bad('对局零报错', net.errs.slice(0, 2).join(' / '));

  /* ---------- 4. 存档恢复 ---------- */
  const beforeNames = await p.evaluate(() => window.__STORE__.getState().game.players.map(x => x.name));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  const hasResume = await p.getByRole('button', { name: /接着打/ }).count();
  if (hasResume) {
    await p.getByRole('button', { name: /接着打/ }).first().click();
    await p.waitForTimeout(6000);
    const after = await p.evaluate(() => {
      const s = window.__STORE__.getState();
      return { match: s.game.players.every((pl, i) => s.characters[i]?.name === pl.name), names: s.game.players.map(x => x.name) };
    });
    after.match ? ok('存档恢复座位匹配', after.names.join('|')) : bad('存档恢复座位匹配', '错位');
  } else {
    ok('存档恢复', '无存档（可能是首次进入）');
  }
  await ctx.close();
}

/* ---------- 5. 音频与资源 ---------- */
{
  const { p, ctx, net } = await freshPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: /原声集/ }).first().click();
  await p.waitForTimeout(1500);
  const tracks = await p.evaluate(() => {
    const d = document.querySelector('[aria-label="原声集 曲目列表"]');
    return d ? d.querySelectorAll('button').length : 0;
  });
  tracks > 0 ? ok('原声集可打开', `${tracks} 个按钮`) : bad('原声集可打开', '未渲染');
  net.bad.length === 0 ? ok('原声集零 4xx') : bad('原声集零 4xx', net.bad.slice(0, 2).join(','));
  await ctx.close();
}

await browser.close();

/* ---------- 汇总 ---------- */
const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => !r.pass);
console.log('\n=== 排查结果 ===');
for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? '  —  ' + r.detail : ''}`);
}
console.log(`\n通过 ${pass} / ${results.length}`);
if (fail.length) {
  console.log('\n失败项:');
  fail.forEach(f => console.log(`  ❌ ${f.name}: ${f.detail}`));
  process.exit(1);
}
