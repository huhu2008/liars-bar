import type { Card } from '@liars/engine';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CARD_T, tableCardSlot } from './constants';
import { Card3D } from './Card3D';

/**
 * 收牌：一轮结束时，桌上的牌依次飞回牌堆。
 *
 * 与 PlayedCard 相反 —— 起点是牌在桌上的位置，终点是牌堆中心，
 * 所有牌保持实体尺寸，依次落到牌堆顶上。
 */
export function CollectCards({
  cards,
  round,
  pilePosition,
}: {
  cards: Card[];
  /** 轮次变化时重放动画 */
  round: number;
  pilePosition: [number, number, number];
}) {
  const group = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);

  // 每张牌在桌上的位置（和揭示时的排法一致）
  const slots = useMemo(
    () => cards.map((_, i) => tableCardSlot(i, cards.length)),
    [cards],
  );

  useFrame((state) => {
    if (start.current === null) start.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - start.current;

    group.current?.children.forEach((child, i) => {
      const g = child as THREE.Group;
      const delay = i * 0.07;
      const t = elapsed - delay;
      if (t <= 0) {
        g.visible = false;
        return;
      }
      g.visible = true;

      const dur = 0.34;
      const p = Math.min(1, t / dur);
      const e = p * p * (3 - 2 * p); // 平滑起落

      const from = slots[i] ?? slots[0];
      const to = pilePosition;
      // 往中间收的时候抬一下，别贴着桌面擦
      const h = Math.sin(p * Math.PI) * 0.16;

      g.position.set(
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] + i * CARD_T - from[1]) * e + h,
        from[2] + (to[2] - from[2]) * e,
      );
      // 从翻开时的方向转到牌堆方向，全程使用同一副牌的宽度和厚度。
      g.rotation.y = -.3 * e;
    });
  });

  return (
    <group ref={group} key={round}>
      {cards.map((card, i) => (
        <group key={`${round}-${card.id}-${i}`} position={slots[i]}>
          {/* 延续刚刚翻开的正面，收牌途中保持同一张牌的图案。 */}
          <Card3D card={card} faceUp position={[0, 0, 0]} />
        </group>
      ))}
    </group>
  );
}
