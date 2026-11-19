import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const names = [['狐', /狐.*狡狐/], ['鸦', /鸦.*鸦先生/], ['猪', /猪.*屠夫/], ['猫', /猫.*小猫/], ['法', /法.*法师/], ['浪', /浪.*浪人/]];
for (const [label, sel] of names) {
  await p.getByRole('button', { name: sel }).first().click();
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `/tmp/pv-${label}.png`, clip: { x: 865, y: 125, width: 330, height: 230 } });
  console.log(`已拍 ${label}`);
}
await b.close();
