import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(5000);

const rows = await p.evaluate(() => {
  // 把 rgba 叠在给定底色上
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, bb, a = 1] = m[1].split(',').map(Number);
    return { r, g, b: bb, a };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // 找出所有带文字的元素
  const out = [];
  const seen = new Set();
  document.querySelectorAll('*').forEach((el) => {
    const txt = el.textContent?.trim();
    if (!txt || txt.length > 40 || el.children.length > 0) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return;
    const key = `${txt.slice(0,16)}|${cs.color}|${cs.fontSize}`;
    if (seen.has(key)) return;
    seen.add(key);
    const fg = parse(cs.color);
    if (!fg) return;
    // 背景取最近的实色祖先
    let node = el, bgc = { r: 11, g: 6, b: 3, a: 1 };
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) { bgc = c; break; }
      node = node.parentElement;
    }
    const blended = blend(fg, bgc);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 18 || (size >= 14 && bold);
    out.push({
      text: txt.slice(0, 18),
      size,
      color: cs.color,
      ratio: Number(ratio(blended, bgc).toFixed(2)),
      need: large ? 3 : 4.5,
    });
  });
  return out;
});

const fail = rows.filter(r => r.ratio < r.need);
console.log(`检查 ${rows.length} 处文字，不达标 ${fail.length} 处`);
fail.sort((a,b) => a.ratio - b.ratio).slice(0, 8).forEach(r =>
  console.log(`  ${r.ratio}:1 (需 ${r.need}) ${r.size}px  「${r.text}」`));
await b.close();
