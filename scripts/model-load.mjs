import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const reqs = [];
p.on('response', async r => {
  const u = r.url();
  if (/\.glb/.test(u)) {
    try {
      const len = Number(r.headers()['content-length'] ?? 0);
      reqs.push({ file: u.split('/').pop(), status: r.status(), kb: Math.round(len / 1024) });
    } catch { /* ignore */ }
  }
});
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const t0 = Date.now();
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForTimeout(12000);
console.log('进桌后加载的 GLB:');
reqs.forEach(r => console.log(`  ${r.status} ${r.file}  ${r.kb}KB`));
const total = reqs.reduce((n, r) => n + r.kb, 0);
console.log(`合计: ${reqs.length} 个文件 / ${Math.round(total / 1024)}MB`);
console.log('404 或失败:', reqs.filter(r => r.status >= 400).length);
console.log('错误:', errs.length ? errs[0] : '无');
await b.close();
