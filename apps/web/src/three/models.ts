/**
 * 角色立绘：Codex 生成的拟人动物，已抠成透明 PNG（public/chars/*.png）。
 * 游戏里用 billboard 平面渲染，始终朝向相机。
 */

import { asset } from '../data/assetPath';

export type ModelKey = 'fox' | 'raven' | 'boar' | 'cat' | 'mage' | 'rogue';

/** 选角与牌桌分别加载同一轮原画还原的站姿和坐姿资产。 */
export function characterModelPath(species: ModelKey, seated: boolean): string {
  return seated ? `seated/${species}-table-v5` : `preview/${species}-art-v2`;
}

export interface StandeeSpec {
  file: string;
  /** 世界里的人物高度（米） */
  height: number;
  /** 图片宽高比（宽 / 高），用于算平面尺寸 */
  aspect: number;
}

/**
 * 每个 3D 模型在**原始文件里**的实际高度。
 *
 * 这几个模型来自不同来源，原始尺寸差了三个数量级（mage 只有 0.022 米高，
 * boar 接近 2 米），Draco 压缩后 accessor 的 min/max 还可能被量化成 32767。
 * 所以不能靠运行时算包围盒，这里把真实高度写死，用它换算缩放。
 */
export const MODEL_RAW_HEIGHT: Record<ModelKey, number> = {
  fox: 1.9,      // 原始 bounds 被量化，按立绘比例给
  raven: 1.432,
  boar: 1.992,
  cat: 1.997,
  mage: 0.022,
  rogue: 0.005,
};

/**
 * 模型在**自身根节点变换之后**的实际渲染高度（米）。
 *
 * 这几个模型来自不同来源，根节点自带的缩放五花八门：mage/rogue 是 100 倍，
 * boar 没有缩放，raven 是 0.72。所以几何高度和最终尺寸差了几个数量级。
 * 这里记的是「直接量出来多高」，用它反推需要的缩放系数。
 */
export const MODEL_RENDER_HEIGHT: Record<ModelKey, number> = {
  fox: 1.9,     // bounds 异常，按立绘比例给
  raven: 1.35,
  boar: 1.99,
  cat: 1.9,     // bounds 异常，按立绘比例给
  mage: 3.4,
  rogue: 1.45,
};

/** 模型原点到底部的距离比例（0~1），用来把脚落到地面 */
export const MODEL_BOTTOM_RATIO: Record<ModelKey, number> = {
  fox: 0, raven: 0, boar: 0, cat: 0, mage: 0, rogue: 0,
};

export const CHARACTER_STANDEES: Record<ModelKey, StandeeSpec> = {
  // 499 × 1100
  fox: { file: asset('chars/fox.png'), height: 1.96, aspect: 0.454 },
  // 593 × 1100
  raven: { file: asset('chars/raven.png'), height: 2.06, aspect: 0.539 },
  // 660 × 1100
  boar: { file: asset('chars/boar.png'), height: 1.9, aspect: 0.6 },
  // 624 × 1100
  cat: { file: asset('chars/cat.png'), height: 1.52, aspect: 0.567 },
  // 两位人类角色共用选角页的透明站姿立绘，图片尺寸均为 320 × 480。
  mage: { file: asset('chars/mage-preview.webp'), height: 1.86, aspect: 2 / 3 },
  rogue: { file: asset('chars/rogue-preview.webp'), height: 1.9, aspect: 2 / 3 },
};

export const MODEL_LIST = Object.keys(CHARACTER_STANDEES) as ModelKey[];
