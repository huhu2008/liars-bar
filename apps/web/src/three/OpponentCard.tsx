import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { SPEED } from '../store';
import { Card3D } from './Card3D';
import { CARD_SURFACE_Y, TABLE_CARD_SPACING, CARD_W, CARD_T, CARD_D, cardHalfHeight } from './constants';

/** 卡牌与骨架共用本次出牌片段的播放游标，锚点是掌心的世界位置。 */
export interface PlayingHand {
  anchor?: THREE.Object3D;
  /** 模型内按夹持面校准的纸牌中心，随腕部一起移动和转动。 */
  gripFrame?: THREE.Object3D;
  /** 桌边牌摞按掌中这张牌的实际可见性计数，加载模型时也不会少一张。 */
  held?: THREE.Group | null;
  play?: THREE.AnimationAction;
  key?: string;
  finished?: string;
}

/** 同一张暗牌从手里飞到桌上；没出牌时仅在掌心显示一张牌背。 */
export function OpponentCard({ hand, playKey, showAfter, yaw, index = 0, count = 1, back, fallback, target }: {
  hand: PlayingHand; playKey?: string; showAfter?: string; yaw: number; index?: number; count?: number;
  back: THREE.Texture; fallback?: [number, number, number]; target?: [number, number, number];
}) {
  const group = useRef<THREE.Group>(null);
  const started = useRef<number | null>(null);
  const launch = useRef<{ time: number; position: THREE.Vector3; rotation: THREE.Quaternion } | null>(null);
  const flat = useRef(new THREE.Quaternion());
  const localOffset = useRef(new THREE.Vector3());
  const spread = index - (count - 1) / 2;

  useFrame(({ clock }) => {
    const card = group.current;
    if (!card) return;
    const now = clock.elapsedTime * SPEED;
    started.current ??= now;
    // 尚有余牌时，收手完成后再显示下一张，不能与正在打出的牌重叠。
    if (!playKey && (hand.play || (showAfter && hand.finished !== showAfter))) {
      card.visible = false;
      return;
    }
    // 同一手牌共享朝向、中心轨迹和飞行时间，直到展开后才消除厚度间隔。
    let blend = 0;
    if (!launch.current) {
      const palm = hand.anchor;
      if (!palm && !fallback) { card.visible = false; return; }
      if (palm) palm.getWorldPosition(card.position);
      else card.position.fromArray(fallback!);
      if (hand.gripFrame) {
        hand.gripFrame.getWorldPosition(card.position);
        hand.gripFrame.getWorldQuaternion(card.quaternion).normalize();
      } else {
        // 模型加载中的飞牌仍从对应座位出发。
        card.rotation.set(1.05, yaw, 0, 'YXZ');
        card.translateZ(-CARD_D / 2);
        card.translateY(.035);
      }
      card.visible = true;
      if (playKey && target) {
        const action = hand.key === playKey ? hand.play : undefined;
        const releaseTime = palm?.userData.releaseTime ?? .65;
        const elapsed = now - started.current;
        if (action ? action.time >= releaseTime : elapsed >= (palm ? 1.7 : .65)) {
          launch.current = { time: now, position: card.position.clone(), rotation: card.quaternion.clone() };
        }
      }
    }

    const origin = launch.current;
    if (origin && target) {
      const t = Math.min(1, (now - origin.time) / .5);
      blend = 1 - (1 - t) ** 3;
      // 先抬手越过座位前的小物件，再让整叠牌转平，平滑降到各自的牌位。
      card.position.set(
        THREE.MathUtils.lerp(origin.position.x, target[0] - spread * TABLE_CARD_SPACING, blend),
        THREE.MathUtils.lerp(origin.position.y, target[1], blend) + Math.sin(t * Math.PI) * .34,
        THREE.MathUtils.lerp(origin.position.z, target[2], blend),
      );
      card.quaternion.slerpQuaternions(origin.rotation, flat.current, blend);
    }
    // 夹持期间各张纸牌共用同一夹点，仅沿厚度错开；离手后再向各自的桌面牌位展开。
    const spacing = TABLE_CARD_SPACING * blend;
    // 抓持与落桌用同一张实体牌的厚度。
    const thickness = CARD_T;
    // 只有相邻牌的侧边已经分开，才把高度差收为零；偏移沿牌面法线，保证倾斜时也不相交。
    const nest = 1 - THREE.MathUtils.smoothstep(spacing - CARD_W, 0, .03);
    localOffset.current.set(spread * spacing, spread * thickness * nest, 0).applyQuaternion(card.quaternion);
    // 用盒体投影到世界 Y 轴的半高检查整个牌面，而不是只限制牌心的高度。
    // 整叠一起抬高；若只托高最低的那一张，反会把两张原本平行的牌挤入彼此。
    const q = card.quaternion;
    const tangentY = 2 * (q.x * q.y + q.w * q.z);
    const normalY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const spreadDrop = (count - 1) * (Math.abs(tangentY) * spacing * .5 + Math.abs(normalY) * thickness * nest);
    // 手中位置由指尖决定；牌离手向桌内飞行时，平滑接入整叠牌的桌面净空。
    if (origin) {
      const floor = CARD_SURFACE_Y + cardHalfHeight(q, 1) + spreadDrop;
      card.position.y += Math.max(0, floor - card.position.y) * THREE.MathUtils.smoothstep(blend, 0, .15);
    }
    card.position.add(localOffset.current);
  });

  return <group ref={node => {
    group.current = node;
    if (!playKey) hand.held = node;
  }} name={playKey ? 'OpponentPlayedCard' : 'OpponentHeldCard'} visible={false}>
    <Card3D position={[0, 0, 0]} faceUp backTexture={back} />
  </group>;
}
