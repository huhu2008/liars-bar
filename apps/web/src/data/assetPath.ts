/**
 * 资源路径统一入口。
 *
 * 直接用 asset(`assets/...`) 在 itch.io 这类子目录部署下会 404（绝对根路径），
 * 所以所有运行时资源都走这里：内部拼上 vite 的 BASE_URL。
 */
const BASE = import.meta.env.BASE_URL || '/';

/** 把一个以 / 开头的资源路径转成带 base 的路径 */
export function asset(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE}${clean}`;
}

/** 手牌、桌牌和结算共用同一张插画；无美术素材的点数由调用方绘制。 */
export function cardFaceAsset(rank: string, suit: string, id?: string): string | undefined {
  if (rank === 'JOKER') return asset(id === 'JOKER_2' ? 'assets/cards/joker-b.jpg' : 'assets/cards/joker.jpg');
  if (['A', 'K', 'Q'].includes(rank) && ['S', 'H', 'D', 'C'].includes(suit)) {
    return asset(`assets/cards/${rank}-${suit}.webp`);
  }
  return rank === 'J' ? asset('assets/cards/J.jpg') : undefined;
}
