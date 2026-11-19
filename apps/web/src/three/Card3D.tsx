import { useFrame, useThree } from '@react-three/fiber';
import type { Card } from '@liars/engine';
import { useEffect, useMemo, useRef, type Ref } from 'react';
import * as THREE from 'three';
import { cardBackTexture, cardFaceTexture } from './cardTextures';

import { FAN, handHitTargets } from './handLayout';
import { CARD_W, CARD_D, CARD_T } from './constants';

// 保留裁剪坐标 w，牌面倾斜时用透视投影同步点击区域。
const hitCorners = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] as const;

/** 将按钮的两个局部轴映射到真实牌面，浏览器在命中测试时执行同一透视除法。 */
function projectHitTarget(button: HTMLElement, mesh: THREE.Object3D, camera: THREE.Camera, width: number, height: number) {
  const [tl, tr, bl] = hitCorners;
  tl.set(-CARD_W / 2, CARD_T / 2, -CARD_D / 2, 1);
  tr.set(CARD_W / 2, CARD_T / 2, -CARD_D / 2, 1);
  bl.set(-CARD_W / 2, CARD_T / 2, CARD_D / 2, 1);
  for (const v of hitCorners) {
    v.applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    v.x = (v.x + v.w) * width / 2;
    v.y = (v.w - v.y) * height / 2;
  }
  // 左上角归一到 w=1；62×88 是透明按钮自身的 CSS 宽高。
  const invW = 1 / tl.w;
  tr.sub(tl).multiplyScalar(invW / 62);
  bl.sub(tl).multiplyScalar(invW / 88);
  const transform = `matrix3d(${tr.x},${tr.y},0,${tr.w},${bl.x},${bl.y},0,${bl.w},0,0,1,0,${tl.x * invW},${tl.y * invW},0,1)`;
  if (button.style.getPropertyValue('--hand-pose') !== transform) button.style.setProperty('--hand-pose', transform);
}

export interface Card3DProps {
  /** 供手牌记录最近一次渲染使用的世界变换。 */
  meshRef?: Ref<THREE.Mesh>;
  /** 玩家手牌才需要与屏幕上的可操作按钮同步。 */
  handHitId?: string;
  card?: Card;
  position: [number, number, number];
  rotationY?: number;
  /** 基础俯仰（弧度）：0 = 平放桌面；π/2 = 立在镜头前 */
  pitch?: number;
  /** 在牌面平面内旋转（弧度）：手里的扇形展开用它 */
  roll?: number;
  faceUp?: boolean;
  selected?: boolean;
  /** 自定义牌背（角色专属），不传就用默认 */
  backTexture?: THREE.Texture;
  interactive?: boolean;
  scale?: number;
  onClick?: () => void;
}

export function Card3D({
  meshRef,
  handHitId,
  card,
  position,
  rotationY = 0,
  pitch = 0,
  roll = 0,
  faceUp = false,
  selected = false,
  backTexture,
  interactive = false,
  scale = 1,
  onClick,
}: Card3DProps) {
  const group = useRef<THREE.Group>(null);
  const faceMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const size = useThree(state => state.size);
  // 选择、回退共用连续进度；快速反向从当前进度出发，柔和地显示牌面金光。
  const selectProgress = useRef(selected ? 1 : 0);
  // 第一帧就采用指定的面向和尺寸，避免平放牌堆在加载后原地翻穿桌面。
  const initialRotation = useRef<[number, number, number]>([faceUp ? pitch : pitch + Math.PI, rotationY, roll]);
  const initialScale = useRef(scale);
  const face = useMemo(
    () => (card ? cardFaceTexture(card.rank, card.suit, card.id) : null),
    [card?.rank, card?.suit],
  );
  const backMap = useMemo(() => cardBackTexture(), []);

  useEffect(() => () => {
    // 卸下手牌时撤掉过期的命中区域。
    if (handHitId) handHitTargets.get(handHitId)?.style.removeProperty('--hand-pose');
  }, [handHitId]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.05)); // 帧率无关的趋近
    // 抬牌与撤回沿相同时间常数衔接，停顿或低帧率时也保持平稳。
    const selectionBlend = 1 - Math.exp(-18 * Math.min(delta, .08));
    selectProgress.current = THREE.MathUtils.lerp(selectProgress.current, selected ? 1 : 0, selectionBlend);
    // 沿牌面轻抽，亮边和露出的牌角共同标识选择。
    const lift = FAN.selectionLift * selectProgress.current;
    if (faceMaterial.current) faceMaterial.current.emissiveIntensity = .72 * selectProgress.current;
    g.position.x = THREE.MathUtils.lerp(g.position.x, position[0], k);
    g.position.y = handHitId ? position[1] + lift : THREE.MathUtils.lerp(g.position.y, position[1], k);
    g.position.z = THREE.MathUtils.lerp(g.position.z, position[2], k);
    const targetX = faceUp ? pitch : pitch + Math.PI;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, targetX, k);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rotationY, k);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, roll, k);
    // 选择只移动实体；避免纸牌在指间突然胀大。
    g.scale.setScalar(handHitId ? scale : THREE.MathUtils.lerp(g.scale.x, scale, k));
  });

  return (
    <group ref={group} position={position} rotation={initialRotation.current} scale={initialScale.current}>
      <mesh
        ref={meshRef}
        onAfterRender={handHitId ? (_renderer, _scene, camera, _geometry, material) => {
          if (material !== faceMaterial.current) return;
          const button = handHitTargets.get(handHitId);
          const mesh = group.current?.children[0];
          if (button && mesh) projectHitTarget(button, mesh, camera, size.width, size.height);
        } : undefined}
        castShadow
        receiveShadow
        onClick={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onClick?.();
        }}
      >
        <boxGeometry args={[CARD_W, CARD_T, CARD_D]} />
        <meshStandardMaterial attach="material-0" color="#efe6d4" roughness={0.78} metalness={0.04} />
        <meshStandardMaterial attach="material-1" color="#e5d9c3" roughness={0.78} metalness={0.04} />
        {/* 顶面：有牌面就贴牌面，没有就贴牌背（原来给了纯色，牌背朝上时会露出橙块） */}
        <meshStandardMaterial
          attach="material-2"
          map={face ?? backTexture ?? backMap}
          roughness={0.6}
          metalness={0.06}
          ref={faceMaterial}
          emissive="#8a5a10"
          emissiveIntensity={0}
        />
        <meshStandardMaterial attach="material-3" map={backTexture ?? backMap} roughness={0.7} metalness={0.05} />
        <meshStandardMaterial attach="material-4" color="#efe6d4" roughness={0.78} metalness={0.04} />
        <meshStandardMaterial attach="material-5" color="#efe6d4" roughness={0.78} metalness={0.04} />
      </mesh>

    </group>
  );
}
