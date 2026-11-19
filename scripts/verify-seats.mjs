import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// 从实际选角入口入座，核对规则引擎和画面使用的座位顺序。
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(process.env.GAME_URL || 'http://localhost:5183/?turn=60000');
  await page.locator('button.roster-card:visible').filter({ hasText: '狡狐' }).click();
  await page.getByRole('button', { name: /入座/ }).first().click();
  await page.waitForFunction(() => window.__STORE__?.getState().game?.players.length > 0);
  // 每位玩家的名字都必须与相同座位的角色一致，错位时返回失败状态。
  const { players, characters } = await page.evaluate(() => {
    const state = window.__STORE__.getState();
    return {
      players: state.game.players.map(player => player.name),
      characters: state.characters.map(character => character.name),
    };
  });
  assert.deepEqual(players, characters);
  console.log('座位与角色一致', players);
} finally {
  await browser.close();
}
