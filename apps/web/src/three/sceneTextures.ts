import * as THREE from 'three';

/**
 * 场景表面纹理：全部程序化生成，不依赖新素材。
 *
 * 只做「空间感」用得上的四类：
 *   woodTexture   —— 木纹（桌沿 / 桌腿 / 横梁 / 天花板）
 *   glowTexture   —— 柔和圆形渐变（角色脚下光晕、地面光池）
 *   shaftTexture  —— 竖直渐隐（吊灯光柱）
 *   fadeTexture   —— 单向渐隐（墙面上下压暗的暗环）
 *
 * 所有纹理都带缓存：同参数只上传一次显存。
 */

const CACHE = new Map<string, THREE.Texture>();

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 木纹底色：深胡桃，带年轮、节疤、划痕 */
function drawWoodBase(ctx: CanvasRenderingContext2D, s: number, tint: number) {
  const base = ctx.createLinearGradient(0, 0, 0, s);
  base.addColorStop(0, `rgb(${Math.round(38 * tint)},${Math.round(22 * tint)},${Math.round(11 * tint)})`);
  base.addColorStop(0.5, `rgb(${Math.round(48 * tint)},${Math.round(28 * tint)},${Math.round(14 * tint)})`);
  base.addColorStop(1, `rgb(${Math.round(30 * tint)},${Math.round(17 * tint)},${Math.round(8 * tint)})`);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);

  // 宽窄不一的木理带
  for (let i = 0; i < 260; i += 1) {
    const y = Math.random() * s;
    const h = 1 + Math.random() * 6;
    const light = Math.random() > 0.45;
    ctx.fillStyle = light
      ? `rgba(126,80,40,${0.03 + Math.random() * 0.07})`
      : `rgba(10,5,2,${0.04 + Math.random() * 0.1})`;
    ctx.fillRect(0, y, s, h);
  }

  // 起伏的木纹线（横向，正弦扰动 → 不呆板）
  for (let i = 0; i < 46; i += 1) {
    const y0 = Math.random() * s;
    const amp = 2 + Math.random() * 9;
    const freq = 0.008 + Math.random() * 0.03;
    const ph = Math.random() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= s; x += 4) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 2.7 + ph) * amp * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = Math.random() > 0.5
      ? `rgba(132,86,44,${0.05 + Math.random() * 0.09})`
      : `rgba(8,4,1,${0.05 + Math.random() * 0.12})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.2;
    ctx.stroke();
  }

  // 节疤：几圈偏心椭圆
  for (let k = 0; k < 4; k += 1) {
    const cx = Math.random() * s;
    const cy = Math.random() * s;
    const rx = 6 + Math.random() * 14;
    const ry = rx * (0.4 + Math.random() * 0.5);
    for (let ring = 0; ring < 5; ring += 1) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (1 + ring * 0.55), ry * (1 + ring * 0.55), Math.random() * 0.4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(6,3,1,${0.14 - ring * 0.02})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  // 使用痕迹：短划痕 + 磨损亮点
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const len = 4 + Math.random() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 3);
    ctx.strokeStyle = Math.random() > 0.6
      ? `rgba(190,150,100,${0.03 + Math.random() * 0.06})`
      : `rgba(0,0,0,${0.04 + Math.random() * 0.06})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.stroke();
  }
}

export type WoodKind = 'grain' | 'plank';

/**
 * 木纹贴图。
 * @param repeat 平铺次数
 * @param kind   grain=整块木料；plank=拼板（带板缝与钉子），用于地板
 * @param tint   整体明度系数（1 为基准）
 */
export function woodTexture(repeat: [number, number] = [1, 1], kind: WoodKind = 'grain', tint = 1): THREE.Texture {
  const key = `wood:${kind}:${tint}:${repeat[0]}x${repeat[1]}`;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const s = 512;
  const [canvas, ctx] = canvas2d(s, s);
  drawWoodBase(ctx, s, tint);

  if (kind === 'plank') {
    const rows = 4;
    const rowH = s / rows;
    for (let r = 0; r < rows; r += 1) {
      const y = r * rowH;
      // 板与板之间的高光/暗缝
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, y, s, 3);
      ctx.fillStyle = 'rgba(150,104,56,0.10)';
      ctx.fillRect(0, y + 3, s, 2);
      // 错缝接头
      const joint = ((r % 2 === 0 ? 0.28 : 0.66) + Math.random() * 0.06) * s;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(joint, y, 3, rowH);
      // 钉子
      for (const nx of [joint - 18, joint + 20]) {
        if (nx < 8 || nx > s - 8) continue;
        ctx.beginPath();
        ctx.arc(nx, y + rowH * 0.5, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(nx - 0.6, y + rowH * 0.5 - 0.6, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,150,90,0.14)';
        ctx.fill();
      }
    }
  }

  const tex = finish(canvas, true);
  tex.repeat.set(repeat[0], repeat[1]);
  CACHE.set(key, tex);
  return tex;
}

/** 柔和圆形渐变（中心白→边缘全透明），脚光 / 光池 / 投影遮罩通用 */
export function glowTexture(): THREE.Texture {
  const hit = CACHE.get('glow');
  if (hit) return hit;

  const s = 256;
  const [canvas, ctx] = canvas2d(s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.04)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  const tex = finish(canvas, false);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  CACHE.set('glow', tex);
  return tex;
}

/** 竖直渐隐：底部完全透明 → 顶部不透明，用作灯光光柱的 alpha */
export function shaftTexture(): THREE.Texture {
  const hit = CACHE.get('shaft');
  if (hit) return hit;

  const [canvas, ctx] = canvas2d(16, 256);
  const g = ctx.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);

  const tex = finish(canvas, false);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  CACHE.set('shaft', tex);
  return tex;
}

/** 柔光圆点：浮尘用的柔和小圆，避免默认方点精灵出现硬方块 */
export function dotTexture(): THREE.Texture {
  const hit = CACHE.get('dot');
  if (hit) return hit;

  const [canvas, ctx] = canvas2d(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);

  const tex = finish(canvas, false);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  CACHE.set('dot', tex);
  return tex;
}

/** 单向渐隐：0 → 1 的线性 alpha 渐变，用来做墙面上下压暗的暗环 */
export function fadeTexture(): THREE.Texture {
  const hit = CACHE.get('fade');
  if (hit) return hit;

  const [canvas, ctx] = canvas2d(8, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);

  const tex = finish(canvas, false);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  CACHE.set('fade', tex);
  return tex;
}
