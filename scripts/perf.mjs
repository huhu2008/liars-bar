import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=2000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(3000);

const perf = await p.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (++n >= 180) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  frames.sort((a, b) => a - b);
  const mem = performance.memory;
  return {
    avgMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
    p50: +frames[Math.floor(frames.length * 0.5)].toFixed(2),
    p95: +frames[Math.floor(frames.length * 0.95)].toFixed(2),
    worst: +frames[frames.length - 1].toFixed(2),
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    drawCalls: null,
  };
});
console.log('帧耗时:', JSON.stringify(perf));
await b.close();
