import type { Card } from '@liars/engine';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useRef } from 'react';
import * as THREE from 'three';
import { Card3D } from './Card3D';
import { SPEED, useGame } from '../store';
import { gameNow } from '../gameClock';
import { FLIP_DURATION_MS, FLIP_INTERVAL_MS } from '../data/challengeReveal';
import { CARD_D, CARD_W, cardHalfHeight, CARD_SURFACE_Y } from './constants';

/** 按公开顺序原位翻牌，决定性的一张摊开后才显示判定标记。 */
export function PlayedCard({ card, back, position, index, mark, label }: {
  card: Card;
  back: THREE.Texture;
  position: [number, number, number];
  index: number;
  mark?: 'lie' | 'truth';
  label?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const border = useRef<THREE.Mesh>(null);
  const markedAt = useRef<number | null>(null);

  useFrame(() => {
    const mesh = group.current;
    if (!mesh) return;
    const stage = useGame.getState().challengeReveal;
    const now = gameNow();
    // 恢复已结算存档时直接摊开；减少动画模式依次亮牌，省略空中旋转。
    const elapsed = stage?.startedAt != null ? (now - stage.startedAt) * SPEED - index * FLIP_INTERVAL_MS : 0;
    const progress = !stage ? 1 : stage.startedAt === null ? 0 : stage.reducedMotion
      ? Number(elapsed >= 0) : THREE.MathUtils.smoothstep(elapsed, 0, FLIP_DURATION_MS);
    mesh.rotation.x = Math.PI * (1 - progress);
    mesh.position.y = Math.max(position[1], CARD_SURFACE_Y + cardHalfHeight(mesh.quaternion, 1));
    if (stage && progress === 1 && stage.turned === index) {
      // 依次确认真实网格已经正面朝上。同步给语音、记牌器和桌面标签。
      useGame.setState({ challengeReveal: { ...stage, turned: index + 1 } });
    }
    if (border.current) {
      markedAt.current ??= now;
      const emphasis = Math.max(0, 1 - (now - markedAt.current) / 380);
      border.current.scale.setScalar(stage?.reducedMotion || !stage ? 1 : 1 + .035 * emphasis);
    }
  });

  return (
    <group name="RevealedCard" userData={{ cardId: card.id }} ref={group} position={position} rotation={[Math.PI, 0, 0]}>
      <Card3D card={card} faceUp backTexture={back} position={[0, 0, 0]} />
      {mark && (
        <mesh ref={border} name={mark === 'lie' ? 'FirstFalseOutline' : 'TruthOutline'} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CARD_W * 1.06, CARD_D + CARD_W * .06]} />
          <meshBasicMaterial color={mark === 'lie' ? '#ee725a' : '#e2bc6a'} toneMapped={false} />
        </mesh>
      )}
      {label && (
        <Html center position={[0, .055, -CARD_D / 2 - .11]} zIndexRange={[9, 8]} style={{ pointerEvents: 'none' }}>
          <span className={`whitespace-nowrap rounded border bg-[#190e09]/95 px-2 py-1 text-[11px] font-semibold ${mark === 'lie' ? 'border-red-400/70 text-red-200' : 'border-amber-400/70 text-amber-200'}`}>{label}</span>
        </Html>
      )}
    </group>
  );
}
