import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// 通过 Vite 中运行的真实相机观测转角，避免把画面上其他物体的动画当作转头。
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const url = new URL(process.env.BASE || 'http://localhost:5183');
  url.searchParams.set('turn', '90000');
  await page.goto(url.href);
  await page.getByRole('button', { name: /入座/ }).first().click();
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/@react-three_fiber.js')));
  const table = await page.evaluateHandle(async () => {
    const resource = performance.getEntriesByType('resource').find(entry => entry.name.includes('/@react-three_fiber.js'));
    const { _roots } = await import(resource.name);
    // 牌桌根节点在模型下载完成后才会包含掌中的牌，先等待实际模型挂载。
    const limit = performance.now() + 15000;
    while (performance.now() < limit) {
      const table = [..._roots.values()].map(root => root.store.getState()).find(state => state.scene.getObjectByName('OpponentHeldCard'));
      if (table) return table;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('等待牌桌场景超时');
  });
  const report = await table.evaluate(async table => {
    /** 向牌桌发送触控序列，模拟系统打断和第二根手指。 */
    const send = (type, x, id = 1) => table.gl.domElement.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: 150, pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true,
    }));
    /** 等镜头平滑插值收敛后再测量实际水平转角。 */
    const yaw = async () => {
      await new Promise(resolve => setTimeout(resolve, 650));
      return table.camera.rotation.y;
    };
    const initial = await yaw();
    send('pointerdown', 150);
    send('pointercancel', 150);
    send('pointermove', 350);
    const canceled = await yaw();
    send('pointerup', 350);
    send('pointerdown', 150);
    send('pointermove', 300, 2);
    send('pointerup', 300, 2);
    const other = await yaw();
    send('pointermove', 270);
    const dragged = await yaw();
    window.dispatchEvent(new Event('blur'));
    send('pointermove', 0);
    const blurred = await yaw();
    send('pointerup', 0);
    return { initial, canceled, other, dragged, blurred };
  });
  assert.ok(Math.abs(report.canceled - report.initial) < .01, '取消触控后仍然转头');
  assert.ok(Math.abs(report.other - report.initial) < .01, '第二根手指抢占镜头');
  assert.ok(Math.abs(report.dragged - report.other) > .25, '主指针拖动未转头');
  assert.ok(Math.abs(report.blurred - report.dragged) < .035, '窗口失焦后仍然转头');
  console.log('相机拖动和中断回归通过', report);
} finally {
  await browser.close();
}
