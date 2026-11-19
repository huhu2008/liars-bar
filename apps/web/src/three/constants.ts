/** 桌面高度：视觉与物理共用同一个数，改一处两边都跟着变 */
export const TABLE_TOP = 0.52;
export const TABLE_RADIUS = 2.85;

// 63mm 宽的牌在角色掌中占 0.2046 场景单位，对应直径 5.7 的四座牌桌约 1.76m。
export const CARD_W = 0.2046;
export const CARD_D = CARD_W * 88 / 63;
export const CARD_T = CARD_W * 0.30 / 63;
export const TABLE_CARD_SPACING = CARD_W * 1.16;
// 纸底略高于共用桌布基准，分开深度值，同时保持牌叠与桌面的接触。
export const CARD_SURFACE_Y = TABLE_TOP + .00015;

/** 将纸牌盒体的三个半轴投影到世界高度，倾斜时按最低的牌角计算净空。 */
export function cardHalfHeight(q: { x: number; y: number; z: number; w: number }, scale: number): number {
  const { x, y, z, w } = q;
  return scale / 2 * (
    CARD_W * Math.abs(2 * (x * y + w * z)) +
    CARD_T * Math.abs(1 - 2 * (x * x + z * z)) +
    CARD_D * Math.abs(2 * (y * z - w * x))
  );
}
export const DECK_CENTER: [number, number, number] = [1.48, CARD_SURFACE_Y + CARD_T / 2, -0.66];

/** 返回一至三张牌在绒布中央的落点，翻牌和收牌从同一个位置交接。 */
export function tableCardSlot(index: number, count: number): [number, number, number] {
  return [(index - (count - 1) / 2) * TABLE_CARD_SPACING, CARD_SURFACE_Y + CARD_T / 2, -0.12];
}
