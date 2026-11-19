import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
// 抓预览容器的实际宽高，再截图
const box = await p.evaluate(() => {
  const c = document.querySelector('aside canvas');
  const r = c?.getBoundingClientRect();
  return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
});
console.log('预览容器:', JSON.stringify(box));
for (const [label, sel] of [['法', /法.*法师/], ['浪', /浪.*浪人/], ['狐', /狐.*狡狐/]]) {
  await p.getByRole('button', { name: sel }).first().click();
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `/tmp/wide-${label}.png`, clip: box ?? undefined });
}
await b.close();
