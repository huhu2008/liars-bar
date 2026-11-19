import * as THREE from 'three';
import { asset, cardFaceAsset } from '../data/assetPath';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

const IMAGE_CACHE = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

function loadImageTexture(url: string): THREE.Texture {
  const hit = IMAGE_CACHE.get(url);
  if (hit) return hit;
  const tex = loader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.center.set(0.5, 0.5);
  // 与 canvas 牌面保持同一套 UV 补偿
  tex.rotation = Math.PI;
  IMAGE_CACHE.set(url, tex);
  return tex;
}

const faceCache = new Map<string, THREE.Texture>();
let back: THREE.Texture | null = null;
let felt: THREE.Texture | null = null;

/** 牌面：Canvas 现画，零素材依赖。+Y 面 UV 有 180° 偏转，用 texture.rotation 补偿（探针实测）。 */
export function cardFaceTexture(rank: string, suit: string, id?: string): THREE.Texture {
  const face = cardFaceAsset(rank, suit, id);
  if (face) return loadImageTexture(face);
  const key = `${rank}${suit}`;
  const hit = faceCache.get(key);
  if (hit) return hit;

  const w = 256;
  const h = 358;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const paper = ctx.createLinearGradient(0, 0, w, h);
  paper.addColorStop(0, '#fbf6ec');
  paper.addColorStop(1, '#ece0ca');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(122,90,44,0.35)';
  ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  const red = suit === 'H' || suit === 'D';
  const ink = red ? '#b3261e' : '#211710';
  ctx.fillStyle = ink;
  ctx.font = 'bold 48px "PingFang SC", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rank, 22, 18);
  ctx.save();
  ctx.translate(w - 22, h - 18);
  ctx.rotate(Math.PI);
  ctx.fillText(rank, 0, 0);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '136px system-ui, "Apple Symbols", sans-serif';
  ctx.fillText(SUIT_GLYPH[suit] ?? '?', w / 2, h / 2 + 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI;
  faceCache.set(key, tex);
  return tex;
}

export function cardBackTexture(): THREE.Texture {
  return loadImageTexture(asset('assets/cards/back-tankard.webp'));
}

function cardBackCanvasTexture(): THREE.Texture {
  if (back) return back;
  const w = 256;
  const h = 358;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2a1408';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(224,176,98,0.22)';
  ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.strokeStyle = '#c8923f';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = 'rgba(224,176,98,0.85)';
  ctx.font = 'bold 96px "PingFang SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('诈', w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI;
  back = tex;
  return tex;
}

/** 桌面绒布 */
export function feltTexture(): THREE.Texture {
  if (felt) return felt;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size / 2);
  // 深酒红丝绒：原来那套饱和深绿和琥珀色酒馆光是冷色/暖色对撞，
  // 桌子像贴在暗背景上的绿卡片。改成暗酒红后进同一色域，灯一照就沉下去。
  g.addColorStop(0, '#5c2a22');
  g.addColorStop(0.5, '#42201a');
  g.addColorStop(1, '#22100c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // 细颗粒，避免大面积纯色发死
  for (let i = 0; i < 6000; i += 1) {
    ctx.fillStyle = `rgba(255,214,180,${Math.random() * 0.028})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  // 绒面绒毛走向：短促的暖色亮丝，靠近中心多一些
  for (let i = 0; i < 2200; i += 1) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const d = Math.hypot(cx - size / 2, cy - size / 2) / (size / 2);
    if (Math.random() < d * 0.9) continue;
    ctx.strokeStyle = `rgba(255,190,150,${0.03 + Math.random() * 0.05})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (Math.random() - 0.5) * 3, cy + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  felt = tex;
  return tex;
}

/** 小丑牌（小王）：桌面牌堆最上面那张，素材来自 Codex 蓝金 Joker */
let jokerTex: THREE.Texture | null = null;
export function jokerTexture(): THREE.Texture {
  if (jokerTex) return jokerTex;
  jokerTex = loadImageTexture(asset('assets/cards/joker.jpg'));
  return jokerTex;
}

/** 每个角色一套专属牌背：从原型图按完整外框取得山羊、酒杯、猫与鸦和鹿骨。 */
const CHAR_BACK: Record<string, string> = {
  fox: 'goat',
  boar: 'chalice',
  raven: 'cat-raven',
  cat: 'stag',
};

export function characterBackTexture(characterId?: string): THREE.Texture {
  const key = characterId ? CHAR_BACK[characterId] : undefined;
  return key ? loadImageTexture(asset(`assets/cards/back-${key}.webp`)) : cardBackTexture();
}
