import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const reqs = [], errs = [];
p.on('response', r => { if (/vo-qwen\/(mage|rogue)_/.test(r.url())) reqs.push(`${r.status()} ${r.url().split('/').pop()}`); });
p.on('pageerror', e => errs.push(e.message));
for (let i = 0; i < 10; i++) {
  await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /狐.*狡狐/ }).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__);
  const seats = await p.evaluate(() => window.__STORE__.getState().game.players.map(x => x.name));
  if (seats.some(n => n.includes('法师') || n.includes('浪人'))) {
    await p.waitForTimeout(14000);
    const hist = await p.evaluate(() => (window.__VOICE__ ?? []).map(v => `${v.speaker}: ${v.text.slice(0,18)}`));
    console.log(`第${i+1}局:`, seats.join(' | '));
    console.log('新角色语音请求:', reqs.length ? reqs.slice(0, 3) : '无');
    console.log('语音记录:', hist.slice(0, 4));
    break;
  }
}
console.log('404:', reqs.filter(r => r.startsWith('4')).length);
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
