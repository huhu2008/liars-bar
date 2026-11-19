import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

// 独立 Chrome 配置确保不干扰玩家的浏览器；原生双页签用来验证真正的后台与恢复。
const profile = await mkdtemp(join(tmpdir(), 'liars-render-'));
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--user-data-dir=' + profile, '--remote-debugging-port=0', '--no-first-run',
  '--no-default-browser-check', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' });

/** 等待 Chrome 公布随机调试端口，减少并发运行时的端口冲突。 */
async function connect() {
  const marker = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    const port = await readFile(marker, 'utf8').catch(() => '');
    if (port) return chromium.connectOverCDP('http://127.0.0.1:' + port.split('\n')[0], { noDefaults: true });
    await delay(100);
  }
  throw new Error('Chrome 调试端口未就绪');
}

/** 获取当前牌桌画布的真实 WebGL 清屏次数；选角画布的读数单独保存。 */
function countClears(page) {
  return page.evaluate(() => window.tableClears.get(document.querySelector('canvas')) || 0);
}

/** 场景加载和窗口尺寸稳定后连续采样，避免把最后一次必要重绘计入静止耗费。 */
async function checkStill(page, stage) {
  await delay(450);
  const before = await countClears(page);
  await delay(1200);
  const difference = (await countClears(page)) - before;
  assert.equal(difference, 0, stage + '时仍在清屏');
  console.log(stage, '静止清屏次数', difference);
}

/** 切换真实页签并检查浏览器的原生可见性，防止测试只切到了键盘焦点。 */
async function activate(tab, table, hidden) {
  await tab.bringToFront();
  await table.waitForFunction(expected => document.hidden === expected, hidden, { polling: 60, timeout: 5000 });
}

/** 切换触屏视口，检查 canvas 物理像素尺寸及当前渲染确实更新。 */
async function rotate(page, cdp, width, height, expected) {
  const before = await countClears(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await page.waitForFunction(target => {
    const canvas = document.querySelector('canvas');
    return canvas && Math.abs(canvas.width / canvas.clientWidth - target) < .01;
  }, expected, { timeout: 5000 });
  await page.waitForFunction(old => window.tableClears.get(document.querySelector('canvas')) > old, before, { timeout: 5000 });
  console.log(width + '×' + height, 'DPR', expected);
}

let browser;
try {
  browser = await connect();
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  const other = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const otherCdp = await context.newCDPSession(other);
  for (const session of [cdp, otherCdp]) await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 3, mobile: true });
  await activate(page, page, false);
  // 在网页加载前给 WebGL 提供逐画布计数器，测试可直接用于未注入调试接口的生产包。
  await page.addInitScript(() => {
    window.tableClears = new WeakMap();
    const clear = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function (...args) {
      window.tableClears.set(this.canvas, (window.tableClears.get(this.canvas) || 0) + 1);
      return clear.apply(this, args);
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(process.env.BASE || 'http://localhost:5183/');
  url.searchParams.set('turn', '90000');
  await page.goto(url.href);
  await page.getByRole('button', { name: /入座/ }).first().click();
  await page.getByRole('button', { name: '设置', exact: true }).waitFor();
  await page.waitForFunction(() => window.tableClears.get(document.querySelector('canvas')) > 30);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await checkStill(page, '设置');
  await rotate(page, cdp, 390, 844, 1.2);
  await checkStill(page, '竖屏暂停');
  await rotate(page, cdp, 844, 390, 1.8);
  await checkStill(page, '横屏暂停');
  await activate(other, page, true);
  await activate(page, page, false);
  await checkStill(page, '切回仍开着设置的游戏');
  await page.getByRole('button', { name: '关闭设置' }).click();
  const before = await countClears(page);
  await page.waitForFunction(old => window.tableClears.get(document.querySelector('canvas')) > old + 8, before);
  await activate(other, page, true);
  await checkStill(page, '后台');
  await activate(page, page, false);
  const resumed = await countClears(page);
  await page.waitForFunction(old => window.tableClears.get(document.querySelector('canvas')) > old + 8, resumed);
  // 恢复后再旋回竖屏，覆盖暂停和正常播放两种尺寸变更入口。
  await rotate(page, cdp, 390, 844, 1.2);
  assert.deepEqual(errors, []);
  console.log('恢复后持续绘制，无页面异常');
} finally {
  await browser?.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
}
