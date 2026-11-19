import { useGameGLTF } from './useGameGLTF';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cardFaceTexture } from './cardTextures';
import { asset } from '../data/assetPath';
import type { Character } from '../data/characters';
import { characterModelPath } from './models';
import { GESTURE_SECONDS, selectionClips } from './selectionGesture';

type PreviewProps = { character: Character; replay?: number; onReady: (id: string) => void };

/** 准备站姿、相机与待机动作后，再由选角页用画布替换立绘。 */
function PreviewModel({ character, replay, onReady }: PreviewProps) {
  const modelPath = characterModelPath(character.species, false);
  const gltf = useGameGLTF(asset(`assets/models/characters/${modelPath}.glb`));
  const { model, mixer, clips } = useMemo(() => {
    const model = cloneSkeleton(gltf.scene);
    // 正面站姿直接取绑定姿势；有些牌桌 GLB 的第一个片段是出牌或受击。
    model.traverse((node) => { if (/card/i.test(node.name)) node.visible = false; });
    const original = new THREE.Box3().setFromObject(model, true);
    // 首次只逐顶点取一次真实包围盒，后续缩放在包围盒上同步计算。
    const scale = 1.85 / (original.max.y - original.min.y);
    model.scale.multiplyScalar(scale);
    const bounds = new THREE.Box3(original.min.multiplyScalar(scale), original.max.multiplyScalar(scale));
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, .925 - center.y, -center.z);
    bounds.translate(model.position);
    model.updateMatrixWorld(true);
    return { model, mixer: new THREE.AnimationMixer(model), clips: selectionClips(model, character.species, bounds) };
  }, [gltf.scene, character.species]);

  const spark = useRef<THREE.Mesh>(null);
  const sleeveCard = useRef<THREE.Group>(null);
  const reduced = useRef(false);
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    // 六人的站姿同样占画面高度的 84%，高帽与脚底均留出边距。
    const cam = camera as THREE.PerspectiveCamera;
    const distance = (1.85 / .84) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    cam.position.set(0, .925, distance);
    cam.lookAt(0, .925, 0);
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);

  useLayoutEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const gesture = mixer.clipAction(clips.gesture).setLoop(THREE.LoopOnce, 1);
    const idle = mixer.clipAction(clips.idle);
    /** 完成后转入轻微呼吸，快速换人时由下方 cleanup 取消旧动作。 */
    const breathe = () => { if (!reduced.current) idle.reset().play(); };
    /** 启用减少动态时立即恢复站姿，重新允许动态后直接待机。 */
    const syncMotion = () => {
      reduced.current = motion.matches;
      mixer.stopAllAction();
      if (spark.current) spark.current.visible = false;
      if (sleeveCard.current) sleeveCard.current.visible = false;
      if (!motion.matches) breathe();
      // 更新站姿或唤醒待机动作后，请画布绘制第一帧。
      invalidate();
    };
    syncMotion();
    if (!motion.matches) { idle.stop(); gesture.reset().play(); }
    mixer.addEventListener('finished', breathe);
    motion.addEventListener('change', syncMotion);
    return () => {
      motion.removeEventListener('change', syncMotion);
      mixer.removeEventListener('finished', breathe);
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [clips, mixer, model, invalidate, replay]);

  useFrame((_, delta) => {
    if (reduced.current) return;
    // 静止期间不请求后续帧，恢复时避免将整段停顿计入动画。
    invalidate();
    mixer.update(Math.min(delta, 0.1));
    const t = mixer.existingAction(clips.gesture)!.time / GESTURE_SECONDS;
    if (sleeveCard.current) {
      // 从指间侧翻亮牌，绕握住的短边旋转，收手时原路藏回。
      const show = THREE.MathUtils.smoothstep(t, .35, .45) * (1 - THREE.MathUtils.smoothstep(t, .66, .76));
      const card = sleeveCard.current;
      card.visible = show > 0;
      if (card.visible) {
        clips.tip.getWorldPosition(card.position);
        card.position.z += .025;
        card.rotation.set(-.12, (1 - show) * Math.PI * .48, .18 + (1 - show) * .9);
        card.scale.setScalar(show);
      }
    }
    if (spark.current) {
      // 指尖追随真实前臂末端，光晕在画完一圈后渐灭。
      const alpha = THREE.MathUtils.smoothstep(t, .23, .37) * (1 - THREE.MathUtils.smoothstep(t, .69, .85));
      spark.current.visible = alpha > 0;
      if (alpha > 0) {
        clips.tip.getWorldPosition(spark.current.position);
        spark.current.position.z += .02;
        spark.current.scale.setScalar(.18 * alpha);
      }
    }
  });
  useEffect(() => { onReady(character.id); }, [character.id, onReady]);
  return <>
    <primitive object={model} />
    {character.species === 'rogue' && (
      <group ref={sleeveCard} visible={false}>
        <mesh position={[0, .071, 0]}>
          <planeGeometry args={[.12, .17]} />
          <meshBasicMaterial map={cardFaceTexture('A', 'S')} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
    )}
    {character.species === 'mage' && (
      <mesh ref={spark} visible={false} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial transparent depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending}
          vertexShader={'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'}
          fragmentShader={'varying vec2 vUv; void main(){float d=length(vUv-.5)*2.;float glow=exp(-3.1*d)*(1.-smoothstep(.55,1.,d));vec2 a=abs(vUv-.5)*2.;float star=exp(-min(a.x,a.y)*35.)*(1.-smoothstep(.05,.82,max(a.x,a.y)));glow=min(1.,glow+star);gl_FragColor=vec4(mix(vec3(1.,.45,.06),vec3(1.,1.,.76),exp(-9.*d)),glow);}'} />
      </mesh>
    )}
  </>;
}

/** 选角页异步挂载的三维站姿画布。 */
export default function AnimalPreview({ character, replay, onReady }: PreviewProps) {
  // 给帽檐和眼窝留少量暖色补光，保留皮肤材质本身的明暗。
  const humanPreview = character.species === 'mage' || character.species === 'rogue';
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0.9, 5], fov: 40 }}>
      <color attach="background" args={['#150c07']} />
      <ambientLight intensity={1.15} color="#ffdcb4" />
      <directionalLight position={[2.2, 3.6, 2.6]} intensity={2.3} color="#ffcf9c" />
      {/* 野猪围裙和眉弓的底色较深，单独用正面暖白光提亮五官。 */}
      {character.species === 'boar' && <directionalLight position={[-0.5, 1.4, 4]} intensity={12} color="#fff3dd" />}
      {humanPreview && <directionalLight position={[0, 1.8, 4]} intensity={3} color="#fff0da" />}
      {character.species === 'raven' && <directionalLight position={[-2, 2.5, 3]} intensity={6} color="#fff0d6" />}
      <directionalLight position={[1.6, 1.8, -1.4]} intensity={3.2} color="#f2d4ad" />
      {humanPreview && <pointLight position={[0, 1.6, 1.7]} intensity={5} distance={5} color="#ffdfbd" />}
      <pointLight position={[-1.7, 1.2, 1.5]} intensity={7} color={character.palette.accent} />
      <pointLight position={[1.9, 1.6, -1.3]} intensity={4.5} color="#6a4ac8" />
      <Suspense fallback={null}>
        <PreviewModel character={character} replay={replay} onReady={onReady} />
      </Suspense>
      {/* 脚下光斑，别让人浮在虚空里 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[0.62, 40]} />
        <meshStandardMaterial color="#241309" roughness={1} />
      </mesh>
    </Canvas>
  );
}
