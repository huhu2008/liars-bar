import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// 使用 Vite 开发服务器，复用实际牌桌的状态、骨骼、灯光、镜头和渲染器。
const url = new URL(process.env.BASE || 'http://localhost:5183/');
url.searchParams.set('turn', '600000');
url.searchParams.set('speed', '0.7');
const output = new URL('../shots/table-poses/', import.meta.url);
const roles = [['raven', '乌鸦'], ['cat', '猫咪'], ['mage', '法师'], ['rogue', '浪人'], ['boar', '野猪'], ['fox', '狐狸']];
const seats = [
  { seat: 3, label: '左侧', crop: [100, 148, 460, 430] },
  { seat: 2, label: '对面', crop: [526, 145, 340, 335] },
  { seat: 1, label: '右侧', crop: [840, 144, 460, 430] },
];

/** 将三个对手替换为同一角色，减少灯光或角色身高差异对座位比较的影响。 */
async function setCast({ species, base }) {
  const { CHARACTERS } = await import(new URL('src/data/characters.ts', base).href);
  const st = window.__STORE__;
  const { game, characters } = st.getState();
  const actor = CHARACTERS.find(c => c.species === species);
  const players = game.players.map((player, i) => i ? { ...player, name: actor.name } : player);
  st.setState({
    game: { ...game, players, turnSeat: 0, pendingPlay: null },
    characters: players.map((_, i) => i ? actor : characters[0]),
    thinkingSeat: null, speakingSeat: null, tenseSeat: null, shotSeat: null,
  });
}

/** 等待真实模型的三个掌心锚点就绪，排除临时占位模型和仍在切换的上一手牌。 */
async function tableReady(species) {
  const resources = performance.getEntriesByType('resource');
  // 同一角色的坐姿模型可以独立升级，按角色与坐姿资源识别。
  if (!resources.some(r => new URL(r.name).pathname.includes('/seated/' + species + '-table-v') && r.responseEnd > 0)) return false;
  const fiber = resources.find(r => r.name.includes('/@react-three_fiber.js'));
  if (!fiber) return false;
  const { _roots } = await import(fiber.name);
  for (const { store } of _roots.values()) {
    const root = store.getState();
    if (root.scene.getObjectByName('OpponentPlayedCard')) continue;
    let palms = 0;
    let cards = 0;
    root.scene.traverse(obj => {
      if (obj.name === 'CardRelease') palms++;
      if (obj.name === 'OpponentHeldCard' && obj.visible) cards++;
    });
    if (palms >= 3 && cards === 3) {
      window.seatCaptureRoot = root;
      return true;
    }
  }
  return false;
}

/** 在实际渲染调用之后同步截取待机、最后一帧持牌、第一张明显离手的画面。 */
async function capturePlay({ seat, crop }) {
  const { gl, scene } = window.seatCaptureRoot;
  const store = window.__STORE__;
  const game = store.getState().game;
  const render = gl.render;
  const images = {};

  /** 裁剪当帧画布，保留实际桌缘、椅背和手部遮挡关系。 */
  function capture() {
    const [x, y, w, h] = crop;
    const source = gl.domElement;
    const bounds = source.getBoundingClientRect();
    const sx = source.width / bounds.width;
    const sy = source.height / bounds.height;
    const target = document.createElement('canvas');
    target.width = w;
    target.height = h;
    target.getContext('2d').drawImage(source, (x - bounds.left) * sx, (y - bounds.top) * sy, w * sx, h * sy, 0, 0, w, h);
    return target;
  }

  /** 注入一手合法形状的出牌快照以单独驱动此座位的出牌表现。结束后恢复牌局。 */
  function play() {
    const players = game.players.map((p, i) => i === seat ? { ...p, hand: p.hand.slice(1) } : p);
    const pendingPlay = { seat, cards: [game.players[seat].hand[0]], claimCount: 1, claimedRank: game.targetRank };
    store.setState({ game: { ...game, turnSeat: (seat + 1) % 4, players, pendingPlay } });
  }

  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('没有捕获到完整的出牌过程：' + seat)), 15000);
      gl.render = function captureRenderedFrame(...args) {
        render.apply(this, args);
        if (args[0] !== scene) return;
        if (!images.idle) {
          images.idle = capture();
          queueMicrotask(play);
          return;
        }
        const card = scene.getObjectByName('OpponentPlayedCard');
        if (!card?.visible) return;
        // 掌中牌的缩放固定为 .33，离手后按实际飞行进度向 1 展开。
        if (card.scale.x <= .331) images.reach = capture();
        if (card.scale.x > .36 && images.reach) {
          images.release = capture();
          resolve();
        }
      };
    });
    return Object.fromEntries(Object.entries(images).map(([phase, c]) => [phase, c.toDataURL('image/jpeg', .93)]));
  } finally {
    clearTimeout(timer);
    gl.render = render;
    store.setState({ game });
  }
}

/** 生成便于人工逐行比较的角色与动作矩阵，使用等比缩放保留轮廓。 */
async function makeSheet(rows) {
  const sheet = document.createElement('canvas');
  sheet.width = 930;
  sheet.height = rows.length * 278;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#211914';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#ecdab4';
  for (const [i, row] of rows.entries()) {
    for (const [j, [phase, title]] of [['idle', '待机'], ['reach', '伸手'], ['release', '离手']].entries()) {
      const image = new Image();
      image.src = row.images[phase];
      await image.decode();
      const k = Math.min(306 / image.width, 244 / image.height);
      const w = image.width * k;
      ctx.drawImage(image, j * 310 + (310 - w) / 2, i * 278 + 32, w, image.height * k);
      ctx.fillText(row.label + ' · ' + title, j * 310 + 9, i * 278 + 24);
    }
  }
  return sheet.toDataURL('image/jpeg', .94).split(',')[1];
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(url.href);
  await page.getByRole('button', { name: /入座/ }).first().click();
  await page.waitForFunction(() => window.__STORE__?.getState().game?.players.length === 4);
  const sheets = new Map(seats.map(({ seat }) => [seat, []]));
  for (const [species, role] of roles) {
    await page.evaluate(setCast, { species, base: url.href });
    for (const spot of seats) {
      // 在页面主世界查询 R3F 状态，等模型解码和动作归位后才截下一组。
      const deadline = Date.now() + 30000;
      while (!await page.evaluate(tableReady, species)) {
        assert(Date.now() < deadline, role + '的座位模型未就绪');
        await page.waitForTimeout(100);
      }
      // 给上一手的镜头回位和动作淡出留足时间，避免把过渡镜头当作待机画面。
      await page.waitForTimeout(1400);
      const images = await page.evaluate(capturePlay, spot);
      sheets.get(spot.seat).push({ label: role + ' · ' + spot.label, images });
    }
    console.log(role, '三个座位完成');
  }
  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  for (const [seat, rows] of sheets) {
    const data = await page.evaluate(makeSheet, rows);
    const file = new URL('seat-play-' + seat + '.jpg', output);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(fileURLToPath(file));
  }
} finally {
  await browser.close();
}
