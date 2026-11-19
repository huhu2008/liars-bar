// 移动端适配自检：多视口截图 + 溢出诊断 + 手牌命中区点测
import { chromium } from 'playwright-core';

const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:5183/';
const OUT = process.env.OUT ?? '/tmp/m';

const VIEWPORTS = [
  { name: 'iphone-390x844', width: 390, height: 844, touch: true },
  { name: 'se-320x568', width: 320, height: 568, touch: true },
  { name: 'ipad-768x1024', width: 768, height: 1024, touch: true },
  { name: 'desktop-1280x820', width: 1280, height: 820, touch: false },
];

const overflowDiag = () => {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const outOf = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const overflowX = r.right > vw + 1 || r.left < -1;
    const overflowY = r.bottom > vh + 1 || r.top < -1;
    if (!overflowX && !overflowY) continue;
    const cls = (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80);
    const text = (el.textContent ?? '').trim().slice(0, 20);
    const sig = `${el.tagName}.${cls}.${text}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    outOf.push({
      tag: el.tagName,
      cls,
      text,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return {
    vw,
    vh,
    hasHScroll: de.scrollWidth > vw + 1,
    hasVScroll: de.scrollHeight > vh + 1,
    outOf,
  };
};

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const report = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.touch,
    hasTouch: vp.touch,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const selectDiag = await page.evaluate(overflowDiag);
  await page.screenshot({ path: `${OUT}-${vp.name}-select.png` });

  await page.getByRole('button', { name: /入座/ }).first().click();
  await page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 20000 });
  await page.waitForTimeout(5200);

  const tableDiag = await page.evaluate(overflowDiag);
  await page.screenshot({ path: `${OUT}-${vp.name}.png` });

  // 命中区点测：用 3D 层自己的投影点（__HAND__，fov 80）当作「牌在哪」
  const hitTest = await page.evaluate(async () => {
    const probe = (window.__HAND__ ?? []).slice();
    const cards = [...document.querySelectorAll('[data-testid="hand-card"]')];
    const touchNone = (() => {
      const c = document.querySelector('canvas');
      return c ? getComputedStyle(c).touchAction : null;
    })();
    return {
      probe: probe.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      hitBoxes: cards.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }),
      touchNone,
      myTurn: window.__SEL__?.myTurn ?? null,
      turnSeat: window.__SEL__?.turnSeat ?? null,
    };
  });

  // 逐个点 3D 投影点：应精确选中「那一张」，再点它现在的位置取消
  const tapResults = [];
  if (hitTest.myTurn) {
    for (const p of hitTest.probe) {
      const want = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-testid="hand-card"]')?.getAttribute('data-card') ?? null;
      }, p);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(140);
      const on = await page.evaluate(() => window.__SEL__?.selected ?? []);
      // 选中后牌在 3D 里被抬起来了，命中区也跟着搬：点它现在的中心点取消
      const box = await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="hand-card"][data-card="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }, want);
      if (box) await page.mouse.click(box.x, box.y);
      await page.waitForTimeout(140);
      const off = await page.evaluate(() => window.__SEL__?.selected ?? []);
      tapResults.push({ want, on: on.length, hitId: on[0] ?? null, off: off.length });
    }
  }

  // 选中态截图（看 3D 抬起后的观感，顺便确认没有压住 HUD/按钮）
  if (hitTest.myTurn) {
    for (const p of hitTest.probe.slice(0, 3)) {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}-${vp.name}-sel.png` });
  }
  report.push({ viewport: vp.name, selectDiag, tableDiag, hitTest, tapResults });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
