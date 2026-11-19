import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// 用真实选角页验证练习流程，同时保护正式存档和战绩。
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width === 390 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BASE || 'http://localhost:5183/');
    const openPractice = page.getByRole('button', { name: '两分钟练习桌' });
    await openPractice.click();
    const dialog = page.getByRole('dialog', { name: '两分钟练习桌' });
    await dialog.getByRole('button', { name: '退出练习' }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('liars-bar:save')), null);

    // 从真实入座入口取得可续局的快照，再回到首页的锁定名册。
    await page.getByRole('button', { name: /入座/ }).first().click();
    await page.waitForFunction(() => !!localStorage.getItem('liars-bar:save'));
    await page.reload();
    await page.evaluate(() => localStorage.setItem('liars-bar:records', '[]'));
    const saved = await page.evaluate(() => localStorage.getItem('liars-bar:save'));
    await openPractice.click();
    const bluff = dialog.getByRole('button', { name: '出牌，声称是 Q' });
    assert.ok(await bluff.isDisabled());

    // 先完整玩两次，确保重复练习仍按固定种子发 K 与王牌。
    for (let run = 0; run < 2; run++) {
      await dialog.getByRole('button', { name: /^K/ }).first().click();
      await bluff.click();
      assert.equal(await dialog.getByAltText('赖子').count(), 0);
      await dialog.getByRole('button', { name: '质疑鸦先生' }).click();
      await dialog.getByAltText('赖子').waitFor();
      assert.match(await dialog.innerText(), /你质疑失误/);
      if (run === 0) await dialog.getByRole('button', { name: '再练一次' }).click();
    }
    await dialog.getByRole('button', { name: '返回选角' }).click();
    await openPractice.click();
    await page.reload();
    assert.equal(await dialog.count(), 0);
    const persisted = await page.evaluate(() => [localStorage.getItem('liars-bar:save'), localStorage.getItem('liars-bar:records')]);
    assert.deepEqual(persisted, [saved, '[]']);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(width + 'px 练习诈唬、质疑、王牌、退出、再练、刷新及既有存档保护通过');
  }
} finally {
  await browser.close();
}
