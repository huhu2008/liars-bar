import { useFrame, useThree } from '@react-three/fiber';
import type { Card } from '@liars/engine';
import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { SPEED } from '../store';
import { Card3D } from './Card3D';
import { cardHalfHeight, CARD_SURFACE_Y, CARD_W } from './constants';

export interface HandCardPose {
  matrix: THREE.Matrix4;
  index: number;
}

const FACE_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

/** 把选中牌的最后一个世界姿态交给单张场景网格，一次完成离手、翻面和落桌。 */
export function SelfPlayedCard({ card, pose, target, back, fanOffset }: {
  card: Card; pose?: HandCardPose; target: [number, number, number]; back: THREE.Texture; fanOffset: number;
}) {
  const camera = useThree((state) => state.camera);
  const ref = useRef<THREE.Group>(null);
  const flight = useRef<{position: THREE.Vector3; rotation: THREE.Quaternion; lateral: THREE.Vector3; started?: number} | null>(null);
  const [x, y, z] = target;

  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    // 续局时已经落桌的牌无需补播离手；直接恢复其最终朝向和位置。
    if (!pose) {
      group.position.set(x, y, z);
      group.quaternion.copy(FACE_DOWN);
      group.scale.setScalar(1);
      flight.current = null;
      return;
    }
    pose.matrix.decompose(group.position, group.quaternion, group.scale);
    // 将前景手牌从镜头投影空间还原为等大的实体。沿同一视线移动牌心并等比放大四角，屏幕轮廓保持不变。
    const eye = camera.getWorldPosition(new THREE.Vector3());
    group.position.sub(eye).divideScalar(group.scale.x).add(eye);
    group.scale.setScalar(1);
    // 先沿切出时镜头的右轴散开，转头时也不会把靠近镜头的一张穿过后方邻牌。
    const lateral = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(fanOffset * CARD_W * 1.12);
    flight.current = { position: group.position.clone(), rotation: group.quaternion.clone(), lateral };
  }, [pose, x, y, z, camera, fanOffset]);

  useFrame(({ clock }) => {
    const g = ref.current, from = flight.current;
    if (!g || !from) return;
    from.started ??= clock.elapsedTime;
    const p = THREE.MathUtils.clamp((clock.elapsedTime - from.started) * SPEED / .66, 0, 1);
    const t = THREE.MathUtils.smoothstep(p, .16, 1);
    // 先横向打开原本叠在扇面上的牌，再翻面落桌，避免多张牌从彼此中间穿过。
    const spread = THREE.MathUtils.smoothstep(p, 0, .24) * (1 - t);
    const turn = THREE.MathUtils.smoothstep(p, .24, .91);
    g.quaternion.slerpQuaternions(from.rotation, FACE_DOWN, turn);
    g.position.set(THREE.MathUtils.lerp(from.position.x, x, t), THREE.MathUtils.lerp(from.position.y, y, t)
      + Math.sin(Math.PI * p) * .32, THREE.MathUtils.lerp(from.position.z, z, t)).addScaledVector(from.lateral, spread);

    // 倾斜中的牌角低于牌心；按当前旋转后的盒体实际半高给桌面留出间隙。
    g.position.y = Math.max(g.position.y, CARD_SURFACE_Y + cardHalfHeight(g.quaternion, 1));
    if (p === 1) flight.current = null;
  });

  return <group ref={ref} name="SelfPlayedCard" userData={{ cardId: card.id }}>
    <Card3D card={card} faceUp position={[0, 0, 0]} backTexture={back} />
  </group>;
}
