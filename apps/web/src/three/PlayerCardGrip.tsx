import { Suspense, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { asset } from '../data/assetPath';
import type { Character } from '../data/characters';
import { ModelErrorBoundary } from './PropModel';
import { useGameGLTF } from './useGameGLTF';

interface GripProps {
  species: Character['species'];
  releasePose: RefObject<{ open: number; stackDepth: number }>;
}

/** 从角色坐姿模型提取的手臂已在资源内对齐牌面，握姿对应形态权重零。 */
function LoadedGrip({ species, releasePose }: GripProps) {
  const gltf = useGameGLTF(asset(`assets/models/hands/${species}-grip-v5.glb`));
  const grip = useMemo(() => {
    const model = gltf.scene.clone(true);
    // 每个实例记录自己的形态权重，下次切换角色时不会改到缓存模型。
    const stackTargets: { weights: number[]; index: number }[] = [];
    const targets: { weights: number[]; index: number }[] = [];
    model.traverse(node => {
      const mesh = node as Mesh;
      const index = mesh.morphTargetDictionary?.CardReleaseOpen;
      const stackIndex = mesh.morphTargetDictionary?.CardStackDepth;
      if (stackIndex !== undefined && mesh.morphTargetInfluences) {
        stackTargets.push({ weights: mesh.morphTargetInfluences, index: stackIndex });
      }
      if (index !== undefined && mesh.morphTargetInfluences) targets.push({ weights: mesh.morphTargetInfluences, index });
    });
    return { model, targets, stackTargets };
  }, [gltf.scene]);
  // 与牌扇共用同一时钟，跟随实际出牌速度与前后台暂停。
  useFrame(() => {
    // 后侧指腹随牌摞厚度收拢，正面的夹点留在最前一层。
    for (const target of grip.stackTargets) target.weights[target.index] = releasePose.current.stackDepth;
    for (const target of grip.targets) target.weights[target.index] = releasePose.current.open;
  });
  return <primitive object={grip.model} dispose={null} />;
}

/** 手牌和点击区先显示；加载手部素材时不打断发牌或玩家操作。 */
export function PlayerCardGrip({ species, releasePose }: GripProps) {
  return (
    <ModelErrorBoundary key={species} fallback={null}>
      <Suspense fallback={null}>
        <LoadedGrip species={species} releasePose={releasePose} />
      </Suspense>
    </ModelErrorBoundary>
  );
}
