import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PropModel } from './PropModel';

/**
 * 图片道具：Codex 生成的素材（已转透明底）贴在平面上。
 * billboard=true 时绕 Y 轴朝向相机，立在桌上像真占了个位置。
 */
function ImageProp({
  src,
  size,
  position,
  tilt = 0,
  opacity = 1,
  billboard = true,
  aspect,
}: {
  src: string;
  /** 目标高度（世界单位） */
  size: number;
  position: [number, number, number];
  /** 前后倾斜（弧度） */
  tilt?: number;
  opacity?: number;
  billboard?: boolean;
  aspect?: number;
}) {
  const texture = useTexture(src);
  const ref = useRef<THREE.Group>(null);

  const ratio = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (aspect) return aspect;
    const img = texture.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) return img.width / img.height;
    return 1;
  }, [texture, aspect]);

  useFrame(({ camera }) => {
    if (!billboard || !ref.current) return;
    const p = ref.current.position;
    ref.current.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
  });

  const h = size;
  const w = size * ratio;

  return (
    <group ref={ref} position={position} rotation={[tilt, 0, 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.35}
          opacity={opacity}
          toneMapped={false}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* 接地阴影 */}
      <mesh position={[0, -h / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[w * 0.34, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={opacity * 0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}


/** 图片路径对应的原始三维道具；未列出的素材继续使用图片。 */
const PROP_MODELS: Record<string, string> = {
  'chair.png': 'chair-prototype-trial.glb',
  'bottle.png': 'bottle-trial.glb',
  'mug.png': 'tankard-trial.glb',
  'lantern.png': 'lantern-trial.glb',
  'chip.png': 'chip-trial.glb',
  'die.png': 'die-reference-brass-detail-merged-trial-v1.glb',
  'dice.png': 'die-reference-brass-detail-merged-trial-v1.glb',
  'bullet.png': 'cartridge-trial.glb',
};

/** 优先使用三维道具，模型无法加载时保留原图片。 */
export function PropImage(props: Parameters<typeof ImageProp>[0]) {
  const filename = props.src.split('?')[0]?.split('/').pop() ?? '';
  const model = PROP_MODELS[filename];
  if (!model) return <ImageProp {...props} />;
  const fallback = <ImageProp {...props} position={[0, 0, 0]} tilt={0} />;
  return (
    <PropModelAtPosition model={model} props={props} fallback={fallback} />
  );
}

/** 让模型沿用图片道具的世界坐标和倾斜角度。 */
function PropModelAtPosition({ model, props, fallback }: { model: string; props: Parameters<typeof ImageProp>[0]; fallback: React.ReactNode }) {
  return (
    <group position={props.position} rotation={[props.tilt ?? 0, 0, 0]}>
      {/* 筹码是薄片，按高度缩放会把直径放大数十倍；尺寸表示其桌面宽度。 */}
      <PropModel src={model} size={props.size} dimension={model === 'chip-trial.glb' ? 'width' : 'height'} fallback={fallback} />
    </group>
  );
}
