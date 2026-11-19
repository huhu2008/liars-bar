/**
 * 手牌扇形布局：3D 渲染和 2D 点击命中区共用同一套算法，
 * 保证「看到哪张」和「点到哪张」永远一致。
 */

import { CARD_D, CARD_T, CARD_W } from './constants';

// 每张牌的透明按钮由界面注册，渲染器只更新它的 CSS 变换，无需逐帧触发 React。
export const handHitTargets = new Map<string, HTMLButtonElement>();

export const FAN = {
  // 第一人称前景随镜头投影，按手模掌宽保持牌面在可点击范围内。
  scale: .1178 / CARD_W,
  dist: 0.62,
  baseY: -0.27,
  // 窄底部留出共同夹持区，用旋转而非平移露出上方的牌角。
  baseSpread: 0.010,
  // 选中时沿牌面抽出一小段，纸牌及握着它的手保持原尺寸。
  selectionLift: .035,
  step: 0.21,
  cardH: CARD_D,
  cardW: CARD_W,
  // 牌面平行于扇形平面，抬选和绕下缘转动都不会挤进相邻纸牌层。
  tilt: Math.PI / 2,
  fov: 55,
};

export const HALF = (FAN.cardH * FAN.scale) / 2;

/** 每张牌绕靠近下缘的轴展开，薄层错开避免相邻牌面闪烁。 */
export function fanBase(i: number, n: number): [number, number, number] {
  const t = i - (n - 1) / 2;
  // 右边的牌略微靠前，压住左边的牌，给有厚度、带倾角的牌留出层间距，让牌角和花色都可见
  return [t * FAN.baseSpread, FAN.baseY, -FAN.dist + i * CARD_T * FAN.scale * 1.2];
}

/** 外侧的牌向外倾：最左为正角，最右为负角 */
export function fanAngle(i: number, n: number): number {
  const t = i - (n - 1) / 2;
  return -t * FAN.step;
}

export function fanPoint(i: number, n: number, lx = -0.44, ly = 0.5): [number, number, number] {
  const [bx, by, bz] = fanBase(i, n);
  const a = fanAngle(i, n);
  const px = lx * FAN.cardW * FAN.scale;
  const py = ly * FAN.cardH * FAN.scale;
  return [bx + px * Math.cos(a) - py * Math.sin(a), by + px * Math.sin(a) + py * Math.cos(a), bz];
}

/** 镜头空间点 → 屏幕像素（CSS px） */
export function projectToScreen(
  point: [number, number, number],
  width: number,
  height: number,
  fov = FAN.fov,
): { x: number; y: number } {
  const [x, y, z] = point;
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const aspect = width / Math.max(1, height);
  const nx = x / -z / (tanHalf * aspect);
  const ny = y / -z / tanHalf;
  return { x: (nx * 0.5 + 0.5) * width, y: (1 - (ny * 0.5 + 0.5)) * height };
}

/** 每张手牌在屏幕上的点击点 */
export function handScreenPoints(count: number, width: number, height: number) {
  return Array.from({ length: count }, (_, i) => {
    const p = projectToScreen(fanPoint(i, count), width, height);
    const angle = fanAngle(i, count);
    return { i, ...p, angle };
  });
}
