import { useTexture } from '@react-three/drei';
import { asset } from '../data/assetPath';
import { useMemo } from 'react';
import * as THREE from 'three';
import { PropModel } from './PropModel';

/** 共用三维道具与图片回退，演出朝向统一由所属座位的父节点提供。 */
export function Revolver({
  flashRef,
  scale = 1,
  flip = false,
  tilt = 0,
}: {
  flashRef: React.RefObject<THREE.Mesh | null>;
  scale?: number;
  /** 水平翻转：让枪管朝左（第一人称自射时用） */
  flip?: boolean;
  /** 平面内倾斜（弧度），让枪看起来是「斜着顶过来」 */
  tilt?: number;
}) {
  const texture = useTexture(asset('assets/props/revolver.png'));
  const flashTex = useTexture(asset('assets/fx/muzzle-flash.png'));


  const ratio = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const img = texture.image as { width?: number; height?: number } | undefined;
    return img?.width && img?.height ? img.width / img.height : 1.5;
  }, [texture]);

  // 枪高 0.26，宽度按图片比例
  const h = 0.26 * scale;
  const w = h * ratio;

  return (
    <group scale={[flip ? -1 : 1, 1, 1]} rotation={[0, 0, tilt]}>
      {/* 优先显示已有左轮模型，加载失败则保留图片。 */}
      <PropModel src="revolver-trial.glb" size={w} dimension="width" fallback={
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.35}
          toneMapped={false}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      } />
      {/* 枪口焰：用素材里的火花图，叠加混合 */}
      <mesh ref={flashRef} position={[w * 0.44, h * 0.32, 0.02]} scale={0.001}>
        <planeGeometry args={[0.34 * scale, 0.22 * scale]} />
        <meshBasicMaterial
          map={flashTex}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
