import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const bad = [];
p.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace('http://localhost:5183','')}`); });
p.on('requestfailed', r => bad.push(`FAIL ${r.url().replace('http://localhost:5183','')} :: ${r.failure()?.errorText}`));
await p.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
// 逐个点六个角色
for (const sel of [/狐.*狡狐/, /鸦.*鸦先生/, /猪.*屠夫/, /猫.*小猫/, /法.*法师/, /浪.*浪人/]) {
  await p.getByRole('button', { name: sel }).first().click();
  await p.waitForTimeout(1800);
}
console.log('404/失败请求:', bad.length ? bad.slice(0, 8) : '无');
await b.close();
