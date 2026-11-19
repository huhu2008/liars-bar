// 在 Vite 实际对局中检查蒙皮与形变之后的手指是否穿过有限牌面。
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const ids = ['rogue', 'mage', 'fox', 'raven', 'cat', 'boar'];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1140, height: 760 } });
const failures = [];

/** 在真实牌局换入同一角色的四个视角，按要求保留手牌。 */
async function setCase({ id, count }) {
  const { CHARACTERS } = await import('/src/data/characters.ts');
  const state = window.__STORE__;
  const actor = CHARACTERS.find(c => c.id === id);
  const players = window.auditGame.players.map(player => ({
    ...player, name: actor.name, hand: player.hand.slice(0, count),
  }));
  state.setState({
    characters: players.map(() => actor), game: { ...window.auditGame, turnSeat: 0, players },
    selected: [], thinkingSeat: null, inputLocked: false,
  });
}

/** 逐张求三角形与纸张中面的交线，再把交线裁到矩形纸张内部。 */
async function inspect(firstPersonOnly) {
  const T = await import('/node_modules/.vite/deps/three.js');
  const { scene } = window.auditScene;
  const rows = [];
  // 留出牌边千分之一宽度，仅忽略贴边和浮点误差。
  function cutsPaper(a, b, c, w, d) {
    const points = [];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if ((p.y > 0) !== (q.y > 0)) points.push(p.clone().lerp(q, p.y / (p.y - q.y)));
    }
    if (points.length !== 2) return false;
    let start = 0, end = 1;
    for (const [axis, half] of [['x', w / 2], ['z', d / 2]]) {
      const limit = half - w * .001;
      const origin = points[0][axis], step = points[1][axis] - origin;
      if (Math.abs(step) < 1e-10) {
        if (Math.abs(origin) > limit) return false;
      } else {
        const i = (-limit - origin) / step, j = (limit - origin) / step;
        start = Math.max(start, Math.min(i, j));
        end = Math.min(end, Math.max(i, j));
      }
    }
    return end >= start;
  }
  for (const seat of (firstPersonOnly ? [0] : [0, 1, 2, 3])) {
    const rig = seat ? scene.getObjectByName('OpponentStack-' + seat).parent.children[0] : scene.getObjectByName('PlayerCardGrip');
    const cards = [];
    if (seat) {
      // 握牌节点在世界空间中，按它与当前角色握点的距离确定归属。
      const grip = rig.getObjectByName('GripFrame').getWorldPosition(new T.Vector3());
      const held = [];
      scene.traverseVisible(n => { if (n.name === 'OpponentHeldCard') held.push(n); });
      held.sort((a, b) => a.getWorldPosition(new T.Vector3()).distanceToSquared(grip) - b.getWorldPosition(new T.Vector3()).distanceToSquared(grip));
      cards.push(held[0]);
    } else {
      for (const c of window.__STORE__.getState().game.players[0].hand) cards.push(scene.getObjectByName('HandCard-' + c.id));
    }
    for (const card of cards) {
      let box;
      card.traverseVisible(n => { if (n.geometry?.type === 'BoxGeometry') box = n; });
      if (!box) throw Error('缺少实际可见牌面');
      const { width, height, depth } = box.geometry.parameters;
      // 桌边和前景牌须共用实体比例，避免夹持测试漏掉过厚的纸牌模型。
      if (Math.abs(depth / width - 88 / 63) > 1e-5 || Math.abs(height / width - .30 / 63) > 1e-5) {
        throw Error('扑克牌宽长厚比例有误');
      }
      const inverse = box.matrixWorld.clone().invert();
      let cuts = 0, meshes = 0;
      rig.traverseVisible(mesh => {
        if (!mesh.isMesh || (seat && !mesh.isSkinnedMesh)) return;
        meshes++;
        const geometry = mesh.geometry, idx = geometry.index?.array;
        const verts = Array.from({ length: geometry.attributes.position.count }, (_, i) =>
          mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
        for (let i = 0; i < (idx?.length ?? verts.length); i += 3) {
          if (cutsPaper(verts[idx?.[i] ?? i], verts[idx?.[i + 1] ?? i + 1], verts[idx?.[i + 2] ?? i + 2], width, depth)) cuts++;
        }
      });
      if (!meshes) throw Error('座位 ' + seat + ' 缺少可见手部模型');
      rows.push({ seat, card: card.name, cuts });
    }
  }
  return rows;
}

try {
  const base = process.env.GAME_URL || 'http://localhost:5183/';
  await page.goto(base + '?probe=1&turn=650000');
  await page.getByRole('button', { name: /入座/ }).first().click();
  await page.waitForFunction(() => window.__SEL__?.myTurn);
  await page.evaluate(async () => {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 80));
      const resource = performance.getEntriesByType('resource').find(r => r.name.includes('/@react-three_fiber.js'));
      if (!resource) continue;
      const fiber = await import(resource.name);
      window.auditScene = [...fiber._roots.values()].map(r => r.store.getState()).find(r => r.scene.getObjectByName('OpponentStack-1'));
      if (!window.auditScene) continue;
      window.auditGame = structuredClone(window.__STORE__.getState().game);
      return;
    }
    throw Error("牌桌场景未就绪");
  });
  for (const id of (process.argv[2]?.split(',') || ids)) {
    for (const count of [1, 2, 3, 4, 5]) {
      await page.evaluate(setCase, { id, count });
      await page.evaluate(async () => {
        for (let attempt = 0; attempt < 180; attempt++) {
          const scene = window.auditScene.scene;
          let handVisible = false;
          scene.getObjectByName('PlayerCardGrip')?.traverseVisible(node => { if (node.isMesh) handVisible = true; });
          if (handVisible && [1, 2, 3].every(seat => scene.getObjectByName('OpponentStack-' + seat)?.parent.children[0]?.getObjectByName('GripFrame'))) return;
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        throw Error('角色还未入座');
      });
      await page.waitForTimeout(1250);
      // 单张、整扇及抬选时都可能发生穿模，选牌走真实游戏入口。
      for (const phase of ['持牌', '选牌', '撤回']) {
        if (phase !== '持牌') {
          await page.evaluate(() => {
            const state = window.__STORE__.getState();
            state.toggleCard(state.game.players[0].hand[0].id);
          });
          await page.waitForTimeout(400);
        }
        const rows = await page.evaluate(inspect, phase !== '持牌');
        const bad = rows.filter(r => r.cuts > 0);
        console.log(id, count, phase, JSON.stringify(rows.map(r => r.cuts)));
        failures.push(...bad.map(r => ({ id, count, phase, ...r })));
      }
    }
  }
  assert.deepEqual(failures, [], '手部三角面穿过纸张内部');
} finally {
  await browser.close();
}
