import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Mood } from './Animal';
import { CHARACTER_STANDEES, type ModelKey } from './models';

const MOOD_CODE: Record<Mood, number> = { idle: 0, think: 0.25, shock: 1, win: 0.5, dead: 2 };

/**
 * 2D 立绘角色 + 顶点骨骼动画。
 *
 * 不做切图分层（脖子会裂缝），而是在顶点着色器里按 uv.y 分段加权重：
 *   头部（uv.y > 0.62）权重最高 → 转头时只有上半身动
 *   腰部（uv.y 0.30~0.70）中等 → 呼吸起伏
 *   腿部（uv.y < 0.30）基本不动 → 站在地上不飘
 */
export function CharStandee({
  species,
  mood,
  alive = true,
  seated = false,
  gaze = 0,
  tense = false,
  tellAmp = 0.5,
}: {
  species: ModelKey;
  mood: Mood;
  alive?: boolean;
  seated?: boolean;
  /** 视线方向：-1 看左、0 看正前、1 看右（别人说话时头会偏过去） */
  gaze?: number;
  /** 手牌所剩不多时，耳朵或尾巴显出紧张 */
  tense?: boolean;
  /** 破绽幅度 0–1，角色性格不同（fox 1.0 / cat 0.6 / raven 0.4 / boar 0.3） */
  tellAmp?: number;
}) {
  const spec = CHARACTER_STANDEES[species];
  const texture = useTexture(spec.file);
  const group = useRef<THREE.Group>(null);
  const cameraInSeat = useMemo(() => new THREE.Vector3(), []);
  const uniforms = useRef({
    uTime: { value: 0 },
    uMood: { value: 0 },
    uSeed: { value: 0 },
    uGaze: { value: 0 },
    uShockT: { value: 99 },
    uTense: { value: 0 },
    uTellAmp: { value: 0.5 },
  });

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.42,
      toneMapped: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.current.uTime;
      shader.uniforms.uMood = uniforms.current.uMood;
      shader.uniforms.uSeed = uniforms.current.uSeed;
      shader.uniforms.uGaze = uniforms.current.uGaze;
      shader.uniforms.uShockT = uniforms.current.uShockT;
      shader.uniforms.uTense = uniforms.current.uTense;
      shader.uniforms.uTellAmp = uniforms.current.uTellAmp;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uMood;
           uniform float uSeed;
           uniform float uGaze;
           uniform float uShockT;
           uniform float uTense;
           uniform float uTellAmp;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>

           float t = uTime + uSeed;
           bool dead  = uMood > 1.5;
           bool shock = abs(uMood - 1.0) < 0.2;
           bool win   = abs(uMood - 0.5) < 0.2;

           float head  = smoothstep(0.60, 0.96, uv.y);
           float torso = smoothstep(0.30, 0.70, uv.y);

           float breathe = sin(t * 1.5) * 0.010 * torso;
           transformed.y += breathe;
           transformed.x += breathe * 0.25;

           float look = sin(t * 0.8) * 0.016 + sin(t * 0.31) * 0.010;
           transformed.x += look * head * head;

           // 视线跟随：头朝说话的人偏过去（幅度压小，像余光扫过去）
           transformed.x += uGaze * head * head * 0.085;

           // ── 耳朵与尾巴：各自独立通道，不再被呼吸权重带走 ──
           // 耳尖在 uv.y 0.86–0.99；尾巴在左下 uv.x 0.06–0.46 / uv.y 0.13–0.49
           float ear  = smoothstep(0.86, 0.97, uv.y);
           float tail = smoothstep(0.49, 0.34, uv.y) * smoothstep(0.46, 0.30, uv.x);

           // 尾巴平时轻摆（原来被 torso 带着抖，是 bug）
           transformed.x += sin(t * 1.1 + 1.7) * 0.022 * tail;

           // 紧张（打算撒谎）：耳朵高频抖、尾巴炸毛外推
           if (uTense > 0.01) {
             float k = uTense * uTellAmp;
             transformed.x += sin(t * 38.0) * 0.007 * k * (ear + tail * 0.6);
             transformed.y += sin(t * 24.0) * 0.004 * k * ear;
             transformed.x += sign(uv.x - 0.26) * 0.008 * k * tail;
           }

           // 被抓包的三段反应：
           //   0.00–0.18s 僵住（一动不动，像被点穴）
           //   0.18–0.55s 后仰（上半身猛地往后缩）
           //   0.55s 之后  发抖（高频小幅抖，越靠头越明显）
           if (shock) {
             float stagger = smoothstep(0.18, 0.55, uShockT);   // 后仰进度
             float tremble = smoothstep(0.55, 0.75, uShockT);   // 发抖强度
             transformed.z += head * 0.042 * stagger;
             transformed.y += head * 0.020 * stagger;
             transformed.x += sin(t * 30.0) * 0.011 * tremble * (0.4 + head);
             transformed.y += cos(t * 24.0) * 0.006 * tremble;
           }

           if (win) {
             transformed.y += 0.012 + sin(t * 2.2) * 0.006;
           }

           // 思考中：头部小幅游移 + 轻微前倾，像在掂量要不要抓人
           bool think = abs(uMood - 0.25) < 0.12;
           if (think) {
             transformed.x += sin(t * 3.1) * 0.006 * head;
             transformed.y += sin(t * 1.9) * 0.004;
             transformed.z -= head * 0.012;
           }

           if (dead) {
             transformed.x += head * 0.05;
             transformed.y -= torso * 0.10;
           }
           `,
        );
    };

    uniforms.current.uSeed.value = (species.charCodeAt(0) % 7) * 0.9;
    return mat;
  }, [texture, species]);

  useEffect(() => {
    uniforms.current.uMood.value = MOOD_CODE[alive ? mood : 'dead'];
  }, [mood, alive]);

  // 视线平滑过渡：直接跳会像抽搐
  const gazeTarget = useRef(gaze ?? 0);
  gazeTarget.current = gaze ?? 0;
  const wasShock = useRef(false);
  useFrame((_, delta) => {
    const u = uniforms.current.uGaze;
    u.value = THREE.MathUtils.lerp(u.value, gazeTarget.current, Math.min(1, delta * 4));

    // 紧张状态平滑过渡（撒谎时耳朵抖、尾巴炸毛）
    const ut = uniforms.current.uTense;
    ut.value = THREE.MathUtils.lerp(ut.value, tense ? 1 : 0, Math.min(1, delta * 3));
    uniforms.current.uTellAmp.value = tellAmp;

    // 被抓包反应计时：刚进入 shock 时归零，之后累加
    const isShock = alive && mood === 'shock';
    const st = uniforms.current.uShockT;
    if (isShock && !wasShock.current) st.value = 0;
    else if (isShock) st.value += delta;
    else st.value = 99;
    wasShock.current = isShock;
  });

  const ratio = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    // 立绘在斜视角下会被拉伸采样， anisotropy 拉满 + 线性过滤更清晰
    texture.anisotropy = 16;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const img = texture.image as { width?: number; height?: number } | undefined;
    return img?.width && img?.height ? img.width / img.height : spec.aspect;
  }, [texture, spec.aspect]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;

    uniforms.current.uTime.value = state.clock.elapsedTime;

    // 每把椅子都有自己的旋转，先将相机换算到椅子局部空间再转向玩家。
    state.camera.getWorldPosition(cameraInSeat);
    g.parent?.worldToLocal(cameraInSeat);
    g.rotation.y = Math.atan2(cameraInSeat.x - g.position.x, cameraInSeat.z - g.position.z);

    const targetTilt = alive && mood !== 'dead' ? 0 : -0.13;
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, targetTilt, 0.08);
    void seated;
  });

  const h = spec.height;
  const w = h * ratio;

  return (
    <group ref={group}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[w * 0.44, 20]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={alive ? 0.32 : 0.16}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, h / 2 - 0.18, 0]}>
        <planeGeometry args={[w * 1.02, h * 1.02, 12, 18]} />
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}
