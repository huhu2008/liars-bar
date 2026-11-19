import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5183/?turn=60000', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /入座/ }).first().click();
await p.waitForSelector('canvas');
await p.waitForFunction(() => !!window.__STORE__);
await p.waitForTimeout(4000);

// 快速切换语音开关 10 次
for (let i = 0; i < 10; i++) {
  await p.evaluate(() => window.__STORE__.getState().toggleVoice());
  await p.waitForTimeout(40);
}
await p.waitForTimeout(1200);
const s = await p.evaluate(() => ({
  voiceOn: window.__STORE__.getState().voiceOn,
  voiceVol: window.__VOICE_VOL__,
  audioCtx: window.__AUDIO_CTX__?.state ?? 'none',
}));
console.log('切换 10 次后:', JSON.stringify(s), typeof s.voiceOn === 'boolean' ? '✅' : '❌');

// 快速调音量 20 次
for (let i = 0; i < 20; i++) {
  await p.evaluate((v) => window.__STORE__.getState().setVolume(v / 100), (i * 13) % 100);
}
await p.waitForTimeout(600);
const v = await p.evaluate(() => window.__STORE__.getState().volume);
console.log('音量连调 20 次后:', v, v >= 0 && v <= 1 ? '✅' : '❌');

// 游戏是否还能继续
await p.waitForTimeout(3000);
const g = await p.evaluate(() => ({
  phase: window.__STORE__.getState().game.phase,
  hand: window.__STORE__.getState().game.players[0].hand.length,
}));
console.log('游戏状态:', JSON.stringify(g));
console.log('错误数:', errs.length, errs.slice(0, 2));
await b.close();
