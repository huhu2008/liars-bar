import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.BASE || 'http://localhost:5183/';
const browser = await chromium.launch({ channel: 'chrome' });

/** 固定已经公开的前一手和弹仓，让实际 CHALLENGE 命令稳定产生指定淘汰结果。 */
async function challenge(page, playSeat, challenger, alive) {
  return page.evaluate(({ playSeat, challenger, alive }) => {
    const store = window.__STORE__;
    const game = structuredClone(store.getState().game);
    const card = game.players[playSeat].hand[0] ?? game.deck[0] ?? game.discard[0];
    game.phase = 'turn';
    game.turnSeat = challenger;
    game.bullets = 6;
    game.players.forEach(player => { player.alive = alive.includes(player.seat); });
    game.pendingPlay = { seat: playSeat, cards: [{ ...card, rank: game.targetRank }], claimCount: 1 };
    store.setState({ game });
    store.getState().dispatch({ t: 'CHALLENGE', seat: challenger });
    return store.getState().game.phase;
  }, { playSeat, challenger, alive });
}

/** 读取实际持久层，检验点击按钮、演出与刷新是否重复写入同一局。 */
async function inspect(page) {
  return page.evaluate(() => ({
    records: JSON.parse(localStorage.getItem('liars-bar:records') || '[]'),
    save: JSON.parse(localStorage.getItem('liars-bar:save') || 'null'),
    id: window.__STORE__.getState().matchId,
  }));
}

/** 用真实存档按钮恢复，确保首页校验、旧档迁移与 store 使用同一份数据。 */
async function resume(page) {
  await page.reload();
  await page.getByRole('button', { name: /接着打/ }).first().click();
  await page.waitForFunction(() => window.__STORE__.getState().screen === 'table');
}

/** 从四人桌早退、继续观战或自然胜出，检查每条正式局路径的结果只记一次。 */
async function verify(width) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(new URL('?speed=3.8&turn=60000', base).href);
    await page.getByRole('button', { name: /入座/ }).first().click();
    await page.evaluate(() => {
      const state = window.__STORE__.getState();
      if (state.voiceOn) state.toggleVoice();
    });
    assert.equal(await challenge(page, 1, 0, [0, 1, 2, 3]), 'round_end');
    const initial = await inspect(page);
    assert.deepEqual(initial.records.map(r => [r.matchId, r.won]), [[initial.id, false]]);
    // 立刻刷新会截断语音和结算演出；回桌后仍应等待玩家决定是否观战。
    await resume(page);
    const watch = page.getByRole('button', { name: '继续观战' });
    await watch.waitFor();
    await page.waitForTimeout(2600);
    assert.ok(await watch.isVisible());
    await watch.click();
    await page.getByRole('dialog', { name: '本轮结算' }).waitFor({ state: 'hidden' });
    assert.equal((await inspect(page)).records.length, 1);
    await page.getByRole('button', { name: '再开一桌' }).click();
    const restarted = await inspect(page);
    assert.notEqual(restarted.id, initial.id);
    assert.equal(restarted.save.matchId, restarted.id);
    assert.ok(restarted.save.game.players.every(p => p.alive));
    // 无标识的历史战绩和旧版已出局快照都要保留；反复恢复同一旧档只迁移一遍。
    const oldSave = { ...initial.save };
    delete oldSave.matchId;
    const oldRecord = { ...initial.records[0] };
    delete oldRecord.matchId;
    await page.evaluate(({ oldSave, oldRecord }) => {
      localStorage.setItem('liars-bar:save', JSON.stringify(oldSave));
      localStorage.setItem('liars-bar:records', JSON.stringify([oldRecord]));
    }, { oldSave, oldRecord });
    await resume(page);
    await resume(page);
    assert.equal((await inspect(page)).records.length, 2);
    await page.getByRole('button', { name: '再开一桌' }).click();
    // 单挑自然获胜，演出前重开仍保留胜场，旧桌的清档定时器不能抹掉新桌。
    assert.equal(await challenge(page, 0, 1, [0, 1]), 'game_end');
    const won = await inspect(page);
    assert.deepEqual(won.records.map(r => r.won), [false, false, true]);
    await page.evaluate(() => window.__STORE__.getState().restart());
    await page.waitForTimeout(1300);
    const final = await inspect(page);
    assert.notEqual(final.id, won.id);
    assert.equal(final.save.matchId, final.id);
    assert.equal(final.records.length, 3);
    // 真人已经记负后继续观战到最后，机器人终局不再追加另一场败局。
    assert.equal(await challenge(page, 1, 0, [0, 1, 2]), 'round_end');
    await page.evaluate(() => window.__STORE__.getState().nextRound());
    assert.equal(await challenge(page, 1, 2, [1, 2]), 'game_end');
    assert.equal((await inspect(page)).records.length, 4);
    assert.deepEqual(errors, []);
    console.log(width, '早退、继续观战、刷新、旧档迁移、自然获胜及新局计时均通过');
  } finally {
    await page.close();
  }
}

try {
  await verify(1280);
  await verify(390);
} finally {
  await browser.close();
}
