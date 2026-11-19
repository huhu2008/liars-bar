import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

// ① 音频文件 404 时游戏能否继续
{
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/vo-qwen/**', route => route.abort());
  await p.route('**/assets/sfx/**', route => route.abort());
  await p.goto('http://localhost:5183/?turn=200', { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(12000);
  const r = await p.evaluate(() => {
    const s = window.__STORE__?.getState();
    return { phase: s?.game?.phase, hand: s?.game?.players?.[0]?.hand?.length, round: s?.game?.round };
  });
  console.log('① 音频全 404:', JSON.stringify(r), '页面错误:', errs.length, '| 游戏继续:', r.phase ? '✅' : '❌');
  await p.close();
}

// ② localStorage 不可用
{
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    const deny = () => { throw new Error('QuotaExceededError'); };
    Object.defineProperty(window, 'localStorage', {
      get() { return { getItem: deny, setItem: deny, removeItem: deny }; },
    });
  });
  await p.goto('http://localhost:5183/?turn=300', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const boot = await p.evaluate(() => document.body.innerText.includes('骗子酒馆'));
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForSelector('canvas');
  await p.waitForFunction(() => !!window.__STORE__, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(8000);
  const r = await p.evaluate(() => {
    const s = window.__STORE__?.getState();
    return { phase: s?.game?.phase, hand: s?.game?.players?.[0]?.hand?.length };
  });
  console.log('② localStorage 禁用:', '启动=' + (boot ? '✅' : '❌'), JSON.stringify(r), '错误:', errs.length);
  await p.close();
}

// ③ 3D chunk 加载失败
{
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  await p.route('**/three/TableCanvas*', route => route.abort());
  await p.goto('http://localhost:5183/?turn=300', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /入座/ }).first().click();
  await p.waitForTimeout(15000);
  const r = await p.evaluate(() => ({
    errUI: document.body.innerText.includes('资源没加载下来') || document.body.innerText.includes('出了点问题') || document.body.innerText.includes('桌子铺得有点久'),
    text: document.body.innerText.slice(0, 50).replace(/\s+/g, ' '),
  }));
  console.log('③ 3D chunk 失败:', r.errUI ? '✅ 显示错误边界' : '⚠️ 无提示', '|', r.text);
  await p.close();
}
await b.close();
