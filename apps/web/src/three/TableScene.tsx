import { gameNow, onGameVisibility, setGameTimeout, clearGameTimeout, type GameTimer } from '../gameClock';
import type { PlayerView } from '@liars/engine';
import { asset } from '../data/assetPath';
import { firstMismatch } from '../data/challengeReveal';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Character } from '../data/characters';
import { readTableReaction } from './tableReaction';
import { Actor, type Mood } from './Animal';
import { Revolver } from './RevolverImg';
import { Card3D } from './Card3D';
import { characterBackTexture, jokerTexture } from './cardTextures';
import { PlayedCard } from './PlayedCard';
import { SelfPlayedCard, type HandCardPose } from './SelfPlayedCard';
import { CollectCards } from './CollectCards';
import { PropImage } from './PropImage';
import { PropModel } from './PropModel';
import { PlayerCardGrip } from './PlayerCardGrip';
import { sfx } from '../audio/sfx';
import { SPEED, useGame } from '../store';
import { feltTexture } from './cardTextures';
import { dotTexture, fadeTexture, glowTexture, shaftTexture, woodTexture } from './sceneTextures';

const TABLE_IMG = asset('assets/table/felt-tile.jpg');
import { TABLE_RADIUS as TABLE_R, TABLE_TOP, CARD_SURFACE_Y, DECK_CENTER, CARD_W, CARD_D, CARD_T, cardHalfHeight, tableCardSlot } from './constants';
import { CHARACTER_STANDEES } from './models';
import { OpponentCard, type PlayingHand } from './OpponentCard';
import { OpponentGun } from './OpponentGun';
import { FAN, HALF, fanAngle, fanBase, fanPoint } from './handLayout';

// 座位半径：之前 2.95 在桌子外侧，4 人局两侧的角色半个身子会出画。
// 收到 2.55 让他们靠近桌心，同时保持和桌子边缘有接触感。
const SEAT_R = 2.55;
// 正常坐姿与对席接近平视，横屏用较窄视野读脸，竖屏保留桌中央三张牌的宽度。
const CAM_FOV = 53;
const EYE_HEIGHT = 1.24;
const EYE_RADIUS_OFFSET = 0.12;
const REST_PITCH = -0.245;

/** 保证窄屏的水平视野仍能容纳落牌区，横屏则按自然座距构图。 */
function tableFov(aspect: number) {
  return Math.max(CAM_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(.48 / aspect)));
}
// 只有显式请求卡牌坐标的自动化页面才逐帧遍历场景。
const ENABLE_SCENE_PROBE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('probe') === '1';

/** 手里的牌：镜头空间常量，牌永远在视野里（跟着头转动） */
function shadeClaw(hex: string): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(0.12, hsl.l - 0.22));
  return `#${c.getHexString()}`;
}

/** 相邻座位沿桌边略朝远端分开，人物、椅子、桌旁道具共用同一角度。 */
function seatAngle(offset: number, total: number) {
  const angle = offset * 2 * Math.PI / Math.max(total, 2);
  return angle + .48 * Math.sin(angle);
}

/** 将围桌角度转换为场景位置，可从任意玩家的座位观察。 */
function seatPos(seat: number, total: number, radius = SEAT_R, viewer = 0): [number, number, number] {
  const angle = Math.PI / 2 - viewer * 2 * Math.PI / Math.max(total, 2) - seatAngle(seat - viewer, total);
  return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
}

/* ------------------------------------------------------------------ */
/* 座位小物：每人一件，用来区分性格                                     */
/* ------------------------------------------------------------------ */

const SEAT_TOKENS: Record<string, { src: string; size: number }> = {
  fox: { src: asset('assets/props/chip.png'), size: 0.17 },     // 狡狐：随手转的筹码
  raven: { src: asset('assets/props/bullet.png'), size: 0.19 }, // 鸦先生：一颗子弹
  boar: { src: asset('assets/props/mug.png'), size: 0.21 },     // 屠夫：喝了一半的酒杯
  cat: { src: asset('assets/props/die.png'), size: 0.15 },      // 小猫：她自己的骰子
};

function SeatToken({
  seat,
  total,
  radius,
  viewer,
  character,
}: {
  seat: number;
  total: number;
  radius: number;
  viewer: number;
  character: Character;
}) {
  const token = SEAT_TOKENS[character.id];
  if (!token) return null;
  // 放在座位靠桌内侧，稍微偏移避免和手牌重合
  const pos = seatPos(seat, total, radius - 0.62, viewer);
  return (
    <PropImage
      src={token.src}
      size={token.size}
      position={[pos[0], TABLE_TOP + token.size * 0.35, pos[2]]}
      opacity={0.95}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 收手牌：用牌背做下落动画（旧牌内容已不可用，只需数量）              */
/* ------------------------------------------------------------------ */

function CollectHandGhosts({ count, active, back }: { count: number; active: boolean; back: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const start = useRef(-1);

  useFrame((state) => {
    if (!active) return;
    if (start.current < 0) start.current = state.clock.elapsedTime;
    const el = (state.clock.elapsedTime - start.current) * SPEED;

    group.current?.children.forEach((child, i) => {
      const g = child as THREE.Group;
      const delay = i * 0.045;
      const p = Math.max(0, Math.min(1, (el - delay) / 0.4));
      const [bx, by, bz] = fanBase(i, count);
      const e = p * p;
      g.visible = p < 1;
      g.position.set(
        bx + (0 - bx) * e * 0.35,
        by - e * 0.34,
        bz + (0.05 - bz) * e,
      );
      g.rotation.z = fanAngle(i, count) * (1 - e);
      g.scale.setScalar(1 - e * 0.5);
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: count }).map((_, i) => (
        <group key={i} position={fanBase(i, count)} rotation={[0, 0, fanAngle(i, count)]}>
          <Card3D faceUp={false} backTexture={back} position={[0, HALF, 0]} pitch={FAN.tilt} scale={FAN.scale} />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 吊灯模型的图片后备                                                  */
/* ------------------------------------------------------------------ */

/** 三维吊灯加载期间显示原提灯图。 */
function LanternFallback({ src, size }: { src: string; size: number }) {
  const tex = useTexture(src);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }, [tex]);
  const img = tex.image as { width?: number; height?: number } | undefined;
  const ratio = img?.width && img?.height ? img.width / img.height : 1;
  return (
    <mesh position={[0, 0, 0.04]}>
      <planeGeometry args={[size, size / ratio]} />
      <meshBasicMaterial map={tex} transparent alphaTest={0.3} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* 探针：把桌面上所有卡牌的变换暴露给自动化                              */
/* ------------------------------------------------------------------ */

function SceneProbe() {
  useFrame(({ scene }) => {
    const list: { p: number[]; r: number[]; s: number[] }[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry as THREE.BoxGeometry | undefined;
      const params = (geo as unknown as { parameters?: { width?: number; height?: number; depth?: number } })
        ?.parameters;
      // 按与渲染器相同的实体尺寸识别纸牌，排除尺寸相近的桌面装饰。
      if (params?.width !== CARD_W || params.height !== CARD_T || params.depth !== CARD_D) return;
      const wp = new THREE.Vector3();
      mesh.getWorldPosition(wp);
      list.push({
        p: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
        r: [+(mesh.rotation.x).toFixed(2), +(mesh.rotation.y).toFixed(2), +(mesh.rotation.z).toFixed(2)],
        s: [+mesh.scale.x.toFixed(2), +mesh.scale.y.toFixed(2), +mesh.scale.z.toFixed(2)],
      });
    });
    (window as unknown as { __CARDS__?: unknown }).__CARDS__ = list;

  });
  return null;
}

/* ------------------------------------------------------------------ */
/* 第一人称摄像机：坐席高度 + 拖动转头（不拖就只看得到正前方）            */
/* ------------------------------------------------------------------ */

/** 从自己的真实眼位朝向目标座位，返回相对桌心方向的水平转角。 */
function opponentYaw(offset: number, total: number, radius: number) {
  const angle = seatAngle(offset, total);
  return Math.atan2(-radius * Math.sin(angle), radius + EYE_RADIUS_OFFSET - radius * Math.cos(angle));
}

/** 将视点固定在玩家椅沿，独立处理手动转头与结算时的自动转向。 */
function FirstPersonCamera({
  seat,
  total,
  seatRadius,
  resetSignal,
  focusSeat,
}: {
  seat: number;
  total: number;
  seatRadius: number;
  resetSignal: number;
  focusSeat: number | null;
}) {
  const { camera, gl } = useThree();
  // 转到最侧面的对手后再留少量余量，避免桌面和其他玩家全部移出画面。
  const sideYaw = Math.max(0.42, ...Array.from({ length: total - 1 }, (_, i) => Math.abs(opponentYaw(i + 1, total, seatRadius)) + 0.1));
  const yaw = useRef(0);
  const pitch = useRef(REST_PITCH);
  const target = useRef({ yaw: 0, pitch: REST_PITCH });
  const manuallyLooking = useRef(false);
  useEffect(() => {
    const el = gl.domElement;
    let pointer: number | null = null;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    /** 首个按下的主按钮拥有本次手势，其他手指不能抢走镜头。 */
    const down = (e: PointerEvent) => {
      if (pointer !== null || !e.isPrimary || e.button !== 0) return;
      pointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    /** 超过点按阈值才开始转头，此后按相邻事件的位置差更新。 */
    const move = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (!dragging && Math.hypot(dx, dy) <= 6) return;
      dragging = true;
      manuallyLooking.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
      target.current.yaw = THREE.MathUtils.clamp(target.current.yaw - dx * 0.0038, -sideYaw, sideYaw);
      target.current.pitch = THREE.MathUtils.clamp(target.current.pitch - dy * 0.0028, -0.62, 0.3);
    };
    /** 系统中断触摸、窗口失焦或打开设置时终止当前手势。 */
    const resetDrag = () => {
      pointer = null;
      dragging = false;
    };
    /** 只有正在控制镜头的指针抬起或取消时才结束拖动。 */
    const end = (e: PointerEvent) => {
      if (pointer === e.pointerId) resetDrag();
    };

    const unsubscribe = onGameVisibility(paused => { if (paused) resetDrag(); });
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', resetDrag);
    return () => {
      unsubscribe();
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', resetDrag);
    };
  }, [gl, sideYaw]);

  // 点「回正」重新交还自动观战控制，主动转头期间保留玩家当前视线。
  useEffect(() => {
    manuallyLooking.current = false;
    target.current = { yaw: 0, pitch: REST_PITCH };
  }, [resetSignal]);

  // 玩家手动观察时，事件不能覆盖他已选的朝向。
  useEffect(() => {
    if (manuallyLooking.current) return;
    if (focusSeat === null) {
      // 焦点解除后要回正，否则结算完镜头一直歪在受罚者的方向
      target.current = { yaw: 0, pitch: REST_PITCH };
      return;
    }
    // 自动转向和手动转头使用同一个眼位，两侧邻座都能落在画面中央。
    target.current = { yaw: opponentYaw(focusSeat - seat, total, seatRadius), pitch: -0.2 };
  }, [focusSeat, seat, total, seatRadius]);

  useFrame((state, delta) => {
    const k = 1 - Math.pow(0.002, Math.min(delta, 0.05));

    yaw.current += (target.current.yaw - yaw.current) * k;
    pitch.current += (target.current.pitch - pitch.current) * k;

    const theta = Math.PI / 2 - (seat * 2 * Math.PI) / Math.max(total, 2);
    const radius = seatRadius + EYE_RADIUS_OFFSET; // 坐在椅沿，视点略高于桌面
    const bob = Math.sin(state.clock.elapsedTime * 0.8) * 0.004;
    camera.position.set(Math.cos(theta) * radius, EYE_HEIGHT + bob, Math.sin(theta) * radius);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, Math.PI / 2 - theta + yaw.current, 0);
    const persp = camera as THREE.PerspectiveCamera;
    const targetFov = tableFov(state.size.width / Math.max(1, state.size.height));
    if (Math.abs(persp.fov - targetFov) > .01) {
      persp.fov = targetFov;
      persp.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }, -1);

  return null;
}

/* ------------------------------------------------------------------ */
/* 体积感：吊灯光柱 + 空气里的浮尘                                       */
/* ------------------------------------------------------------------ */

/** 吊灯下方的半透明光锥：从提灯罩口一路铺到桌面，补上「人和灯之间的空气」 */
function LightShaft({
  topY = 4.16,
  height = 1.34,
  topR = 0.28,
  bottomR = 1.06,
  color = '#ffb066',
  opacity = 0.11,
}: {
  topY?: number;
  height?: number;
  topR?: number;
  bottomR?: number;
  color?: string;
  opacity?: number;
}) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const map = useMemo(() => shaftTexture(), []);
  // 灯焰微微呼吸，光柱跟着晃一下，静帧看着也有空气
  useFrame((state) => {
    if (!mat.current) return;
    const t = state.clock.elapsedTime;
    mat.current.opacity = opacity * (0.86 + Math.sin(t * 1.7) * 0.08 + Math.sin(t * 4.3) * 0.04);
  });
  return (
    <mesh position={[0, topY - height / 2, 0]} renderOrder={6}>
      <cylinderGeometry args={[topR, bottomR, height, 28, 1, true]} />
      <meshBasicMaterial
        ref={mat}
        map={map}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

/** 空气里的浮尘：一片点云缓慢自转，转视线时有视差 */
function DustMotes({
  count = 240,
  radius = 5.4,
  yMin = 0.5,
  yMax = 4.8,
  size = 2.4,
  color = '#ffd0a0',
  opacity = 0.55,
  speed = 0.018,
}: {
  count?: number;
  radius?: number;
  yMin?: number;
  yMax?: number;
  size?: number;
  color?: string;
  opacity?: number;
  speed?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const dot = useMemo(() => dotTexture(), []);
  const geo = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      // 内圈留空：点落在相机旁边会被放大成一坨，这里从 1.2m 外开始撒
      const r = 1.2 + Math.sqrt(Math.random()) * (radius - 1.2);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [count, radius, yMin, yMax]);

  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y += delta * speed;
    g.position.y = Math.sin(state.clock.elapsedTime * 0.32) * 0.06;
  });

  return (
    <group ref={group}>
      <points geometry={geo} frustumCulled={false}>
        {/* sizeAttenuation 关掉：点按像素恒定，走近也不会糊成方块 */}
        <pointsMaterial
          map={dot}
          size={size}
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          sizeAttenuation={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 角色脚下：接地光晕 + 接触阴影                                        */
/* 立绘原来是「贴在虚空里」——脚下没有东西托着。                         */
/* ------------------------------------------------------------------ */

function GroundPool({
  x,
  z,
  radius,
  accent,
}: {
  x: number;
  z: number;
  radius: number;
  accent: string;
}) {
  const glow = useMemo(() => glowTexture(), []);
  return (
    <group position={[x, 0, z]}>
      {/* 接触阴影：脚下一圈压暗，等于给人物加了个「站在地上」的锚点 */}
      <mesh position={[0, -0.161, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <circleGeometry args={[radius * 1.7, 24]} />
        <meshBasicMaterial
          map={glow}
          color="#000000"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* 光晕：用角色主色往地面渗一圈，人物和地板之间不再断开 */}
      <mesh position={[0, -0.157, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[radius * 2.6, 24]} />
        <meshBasicMaterial
          map={glow}
          color={accent}
          transparent
          opacity={0.38}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 桌面与灯光                                                          */
/* ------------------------------------------------------------------ */

function Table3D() {
  const felt = useMemo(() => feltTexture(), []);
  // 只取参考图中的上半部墙面，避免把照片里的地板悬挂到角色身后。
  // 整张墙面环绕一次，圆柱的贴图接缝位于玩家身后，左右两侧分别展示吧台和壁炉。
  const wallTex = useMemo(() => {
    const t = new THREE.TextureLoader().load(asset('assets/scene/tavern-wall2.jpg'));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(1, 0.45);
    t.offset.y = 0.55;
    return t;
  }, []);
  // 绒布的织物颗粒：拿素材当 bumpMap，只在光照边缘起作用，不加 draw call
  const clothBump = useMemo(() => {
    const t = new THREE.TextureLoader().load(TABLE_IMG);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 6);
    return t;
  }, []);

  // 木料：同一套程序化木纹，靠不同 repeat 区分用途
  const edgeWood = useMemo(() => woodTexture([6, 1], 'grain', 1.05), []);
  const topWood = useMemo(() => woodTexture([2.5, 2.5], 'grain', 1.2), []);
  const legWood = useMemo(() => woodTexture([2, 1.2], 'grain', 0.8), []);
  const floorTex = useMemo(() => woodTexture([5, 5], 'plank', 2.6), []);
  const ceilTex = useMemo(() => woodTexture([5, 5], 'grain', 0.62), []);
  const beamTex = useMemo(() => woodTexture([4, 0.4], 'grain', 0.9), []);
  const fadeTex = useMemo(() => fadeTexture(), []);
  const poolTex = useMemo(() => glowTexture(), []);

  return (
    <group>
      {/* 地面：木板地。原来是一块纯黑盘，桌子和角色都像浮在虚空里 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.17, 0]} receiveShadow>
        <circleGeometry args={[18, 48]} />
        <meshStandardMaterial map={floorTex} color="#8a6242" roughness={0.93} metalness={0.03} />
      </mesh>
      {/* 地面光池：桌面溢下来的暖光落在地上，把桌子和地缝起来 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.162, 0]} renderOrder={1}>
        <circleGeometry args={[6.4, 40]} />
        <meshBasicMaterial
          map={poolTex}
          color="#ff9a4d"
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* 三维原型牌桌顶部对齐现有桌面；加载失败时回退原程序化牌桌。 */}
      <group position={[0, TABLE_TOP, 0]}>
        <PropModel src="table-trial.glb" size={TABLE_R * 2} dimension="width" anchor="tabletop" fallback={
          <group position={[0, -TABLE_TOP, 0]}>
      {/* 桌腿：木料 + 底部铁箍 */}
      <mesh castShadow position={[0, 0.23, 0]}>
        <cylinderGeometry args={[0.85, 1.05, 0.46, 40]} />
        <meshStandardMaterial map={legWood} color="#b98f68" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.055, 0]}>
        <cylinderGeometry args={[1.07, 1.09, 0.06, 40]} />
        <meshStandardMaterial color="#3a2a1c" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* 桌身侧沿：木纹不再是纯色块 */}
      <mesh receiveShadow castShadow position={[0, TABLE_TOP - .046, 0]}>
        <cylinderGeometry args={[TABLE_R, TABLE_R * 0.97, 0.09, 64]} />
        <meshStandardMaterial map={edgeWood} color="#c9a279" roughness={0.86} metalness={0.05} />
      </mesh>
      {/* 台面木框：绒布下面垫着一圈实木，压掉「绿盘子」的薄感 */}
      <mesh receiveShadow position={[0, TABLE_TOP - .0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[TABLE_R - 0.02, 64]} />
        <meshStandardMaterial map={topWood} color="#b08a64" roughness={0.8} metalness={0.06} />
      </mesh>
      {/* 桌面绒布：深酒红（原来是饱和深绿，和琥珀灯光对撞） */}
      <mesh receiveShadow position={[0, TABLE_TOP, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[TABLE_R - 0.17, 64]} />
        <meshStandardMaterial
          map={felt}
          color="#e8d4c8"
          roughness={0.97}
          metalness={0}
          bumpMap={clothBump}
          bumpScale={0.02}
        />
      </mesh>
      {/* 桌面内嵌铜线：给绒布一个内圈，牌桌看起来是「做过工的」 */}
      <mesh position={[0, 0.5248, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_R - 0.42, 0.009, 8, 64]} />
        <meshStandardMaterial color="#3d2c14" metalness={0.55} roughness={0.62} />
      </mesh>
      {/* 铜包边：压住绒布与木框的接缝 */}
      <mesh position={[0, 0.528, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_R - 0.06, 0.05, 12, 64]} />
        <meshStandardMaterial color="#8a6630" metalness={0.7} roughness={0.48} />
      </mesh>
          </group>
        } />
      </group>
      {/* 房间：一圈暗木墙 + 顶，转头时不会看到虚空 */}
      <mesh position={[0, 2.2, 0]}>
        <cylinderGeometry args={[7.6, 7.6, 7, 64, 1, true]} />
        <meshStandardMaterial
          map={wallTex}
          color="#b4b4b4"
          roughness={1}
          side={THREE.BackSide}
          emissive="#2a1608"
          emissiveIntensity={0.85}
        />
      </mesh>
      {/* 窄木踢脚线贴着地板收口，给墙脚厚度；柱脚和墙面共用木料色温。 */}
      <mesh position={[0, -0.10, 0]}>
        <cylinderGeometry args={[7.50, 7.46, 0.14, 64, 1, true]} />
        <meshStandardMaterial map={edgeWood} color="#ab805a" roughness={0.94} emissive="#321b0e" side={THREE.BackSide} />
      </mesh>
      {/* 墙面竖向压暗：一圈等亮的墙是「平的」，上下各压一道暗环才有纵深。
          用普通 alpha 混合（乘算层的混合模式会盖到不写深度的立绘上，把人物刷白）。
          注意不设 renderOrder：靠透明排序排在最远处，先画墙再画人。 */}
      <mesh position={[0, 5.45, 0]}>
        <cylinderGeometry args={[7.54, 7.54, 1.9, 48, 1, true]} />
        <meshBasicMaterial
          map={fadeTex}
          color="#0b0503"
          transparent
          opacity={0.95}
          depthWrite={false}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      {/* 天花板：木板顶 + 三根横梁 + 一圈梁圈 */}
      <mesh position={[0, 5.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7.6, 40]} />
        <meshStandardMaterial map={ceilTex} color="#5c4130" roughness={0.95} />
      </mesh>
      <mesh position={[0, 5.44, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[7.2, 0.17, 8, 48]} />
        <meshStandardMaterial map={edgeWood} color="#8a6644" roughness={0.9} />
      </mesh>
      {[0, Math.PI / 3, (Math.PI * 2) / 3].map((a, i) => (
        <mesh key={i} position={[0, 5.42, 0]} rotation={[0, a, 0]} castShadow>
          <boxGeometry args={[14.4, 0.24, 0.32]} />
          <meshStandardMaterial map={beamTex} color="#7d5b3c" roughness={0.92} />
        </mesh>
      ))}
      {/* 天花板吊灯：铁链 + 提灯，是整间屋子最亮的光源 */}
      <group position={[0, 4.55, 0]}>
        <mesh position={[0, 0.68, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.60, 6]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.4} />
        </mesh>
        <PropModel src="lantern-trial.glb" size={0.78}
          fallback={<LanternFallback src={asset('assets/props/lantern.png')} size={0.60} />} />
        <pointLight position={[0, -0.2, 0]} intensity={26} distance={11} decay={2} color="#ffb066" />
      </group>
      {/* 灯下的光柱：把吊灯和桌面在空间上连起来 */}
      <LightShaft />
      {/* 墙柱：保留木构的近景视差，柱间直接露出原画里的壁灯、肖像和吧台。
          转头时近处柱子会明显地移动，房间的尺度感主要靠它撑起来 */}
      {[0.92, 1.97, 3.02, 4.07, 5.12, 6.17].map((a, i) => {
        const x = Math.cos(a) * 7.34;
        const z = Math.sin(a) * 7.34;
        return (
          <group key={`post-${i}`} position={[x, 0, z]} rotation={[0, Math.atan2(-x, -z), 0]}>
            <mesh position={[0, 2.63, 0]} castShadow>
              <boxGeometry args={[0.26, 5.52, 0.3]} />
              <meshStandardMaterial
                map={beamTex}
                color="#c08a56"
                roughness={0.92}
                emissive="#180c04"
                emissiveIntensity={1}
              />
            </mesh>
            {/* 柱头斜撑 + 柱础：木构的细节，别让柱子是根方棍 */}
            <mesh position={[0, 5.22, 0.18]} rotation={[0.5, 0, 0]}>
              <boxGeometry args={[0.24, 0.62, 0.16]} />
              <meshStandardMaterial color="#4a3220" roughness={0.95} />
            </mesh>
            <mesh position={[0, 0.18, 0]}>
              <boxGeometry args={[0.42, 0.5, 0.46]} />
              <meshStandardMaterial map={beamTex} color="#ac8053" roughness={0.95} emissive="#301b0d" />
            </mesh>
          </group>
        );
      })}
      {/* 空气里的浮尘：静止场景里唯一在动的细碎粒子，视线转动时有视差 */}
      <DustMotes />
    </group>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={1.05} color="#ffdcb4" />
      <hemisphereLight args={['#ffd9a8', '#20100a', 0.75]} />
      <pointLight position={[0, 2.6, 0]} intensity={26} distance={13} decay={2} color="#ffab5c" />
      <pointLight position={[-4.4, 2.0, -3.4]} intensity={9} distance={11} decay={2} color="#6a4ac8" />
      <pointLight position={[4.4, 2.0, -2.2]} intensity={7} distance={10} decay={2} color="#2b8a5c" />
      <pointLight position={[0, 2.2, 3.2]} intensity={9} distance={9} decay={2} color="#ffb27a" />
      <directionalLight
        position={[2.4, 6.4, 3.6]}
        intensity={1.1}
        color="#ffcf9c"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.0002}
      />
    </>
  );
}

/**
 * 名字牌的底：从 panel-b 里裁出来的木牌贴图。
 * 预加载成 Image，canvas 里就能同步 drawImage —— 否则要异步等图，牌子会先空一帧。
 */
const NAMEPLATE_IMG = new Image();
NAMEPLATE_IMG.src = asset('assets/ui/nameplate.png');

function makeTagTexture(
  name: string,
  count: number,
  accent: string,
  alive: boolean,
  pending: boolean,
  speaking = false,
): THREE.Texture {
  // canvas 比例要贴合木牌贴图（240×83 ≈ 2.9:1），否则贴图被拉伸、文字落不到内框里
  const w = 512;
  const h = Math.round(w / (240 / 83));   // ≈ 177
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // 底：木牌贴图（已预加载）
  if (NAMEPLATE_IMG.complete && NAMEPLATE_IMG.naturalWidth > 0) {
    ctx.drawImage(NAMEPLATE_IMG, 0, 0, w, h);
  } else {
    // 图还没到位时先画个暗底，避免一帧空白
    ctx.fillStyle = 'rgba(8,5,3,0.85)';
    ctx.fillRect(0, 0, w, h);
  }
  // 说话时加一圈光晕，一眼看出这句是谁说的
  if (speaking) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.shadowBlur = 0;
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = 'bold 52px "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif';
  ctx.fillStyle = alive ? '#f8ecd9' : '#8a6b5a';
  ctx.fillText(name, 56, h / 2 + 4);

  ctx.textAlign = 'right';
  ctx.font = '40px "PingFang SC", system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(`${count} 张${pending ? ' ●' : ''}`, w - 56, h / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 座位名牌留在角色上方，根据屏幕像素限制近处名牌的占幅。 */
function NameTag({
  name,
  count,
  accent,
  alive,
  pending,
  speaking = false,
  position,
}: {
  name: string;
  count: number;
  accent: string;
  alive: boolean;
  pending: boolean;
  /** 正在说这句台词：名牌放大并提亮 */
  speaking?: boolean;
  position: [number, number, number];
}) {
  const texture = useMemo(
    () => makeTagTexture(name, count, accent, alive, pending, speaking),
    [name, count, accent, alive, pending, speaking],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const ref = useRef<THREE.Sprite>(null);
  const cameraSpace = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const sp = ref.current;
    if (!sp) return;
    // 窄视野时保持近处名牌可读且不放大到挡住脸和顶部信息。
    const camera = state.camera as THREE.PerspectiveCamera;
    const viewZ = -sp.getWorldPosition(cameraSpace).applyMatrix4(camera.matrixWorldInverse).z;
    const pixelWidth = state.size.width < 600 ? 92 : 118;
    const widthLimit = 2 * Math.max(.1, viewZ) * pixelWidth / (state.size.height * camera.projectionMatrix.elements[5]);
    const target = Math.min(1.28, widthLimit) * (speaking ? 1.08 : 1);
    sp.scale.x = THREE.MathUtils.lerp(sp.scale.x, target, 0.2);
    sp.scale.y = THREE.MathUtils.lerp(sp.scale.y, (target * 83) / 240, 0.2);
    // 近座的高帽偶尔将牌签顶进角落 HUD；只把相交的牌签靠下，不改变角色位置。
    cameraSpace.applyMatrix4(camera.projectionMatrix);
    const screenX = (1 + cameraSpace.x) * state.size.width / 2;
    const screenY = (1 - cameraSpace.y) * state.size.height / 2;
    const tagHeight = sp.scale.y * camera.projectionMatrix.elements[5] * state.size.height / (2 * Math.max(.1, viewZ));
    const corner = screenX < 240 || screenX > state.size.width - 180;
    const safeTop = state.size.width < 640 ? 56 : 72;
    const nearHud = corner && screenY > -tagHeight && screenY < safeTop + tagHeight / 2;
    sp.center.y = nearHud ? .5 + (safeTop + tagHeight / 2 - screenY) / tagHeight : .5;
    // 牌签为顶角控件让位时移到人物内侧，避免下移后正好挡住五官。
    const centerX = nearHud ? .5 + (screenX < state.size.width / 2 ? -.88 : .88) : .5;
    sp.center.x = THREE.MathUtils.lerp(sp.center.x, centerX, .2);
    sp.position.y = position[1] + (speaking ? Math.sin(state.clock.elapsedTime * 6) * .02 : 0);
  });

  return (
    <sprite ref={ref} position={position} scale={[1.28, (1.28 * 83) / 240, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

/** 桌边牌摞与掌中实体共享剩余张数及角色牌背。 */
function OpponentStack({
  seat,
  count,
  total,
  radius,
  viewer,
  hand,
  back,
}: {
  seat: number;
  count: number;
  total: number;
  radius: number;
  viewer: number;
  hand: PlayingHand;
  back: THREE.Texture;
}) {
  const pos = seatPos(seat, total, radius - 1.2, viewer);
  const rotationY = Math.atan2(pos[0], pos[2]);
  const shown = Math.max(0, Math.min(count, 5));
  const stack = useRef<THREE.Group>(null);
  useFrame(() => {
    // 掌中牌离开桌边时隐藏牌摞顶张；切换动作或模型尚未加载时，余牌全部留在桌边。
    const top = stack.current?.children[shown - 1];
    if (top) top.visible = !hand.held?.visible;
  });
  if (shown === 0) return null;
  return (
    <group name={`OpponentStack-${seat}`} ref={stack} position={[pos[0], CARD_SURFACE_Y + CARD_T / 2, pos[2]]} rotation={[0, rotationY, 0]}>
      {Array.from({ length: shown }).map((_, i) => (
        <Card3D
          key={i}
          position={[i * CARD_W * .008, i * CARD_T, -i * CARD_D * .008]}
          rotationY={(i % 2 === 0 ? 1 : -1) * 0.02}
          faceUp={false}
          backTexture={back}
        />
      ))}
    </group>
  );
}

/**
 * 自己被罚时的第一人称：一把左轮从画面下方抬起来顶住自己的头。
 * 和手牌一样贴在镜头上，所以永远在视野里。
 */
function SelfGun({ active, died }: { active: boolean; died: boolean }) {
  const root = useRef<THREE.Group>(null);
  const gun = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const start = useRef<number | null>(null);
  const fired = useRef(false);
  const { camera } = useThree();

  useEffect(() => {
    start.current = active ? -1 : null;
    fired.current = false;
  }, [active]);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    if (!gun.current) return;
    if (start.current === null) {
      gun.current.position.y = THREE.MathUtils.lerp(gun.current.position.y, -0.8, 0.18);
      if (flash.current) {
        (flash.current.material as THREE.MeshBasicMaterial).opacity = 0;
        flash.current.scale.setScalar(0.001);
      }
      if (light.current) light.current.intensity = 0;
      return;
    }

    if (start.current === -1) start.current = state.clock.elapsedTime;
    // 第一人称举枪与对手举枪及旁白遵循同一节奏倍率。
    const el = (state.clock.elapsedTime - start.current) * SPEED;
    const raise = Math.min(1, el / 0.6);
    const eased = 1 - Math.pow(1 - raise, 3);
    const recoil = el > 0.8 && el < 1.0 ? Math.sin(((el - 0.8) / 0.2) * Math.PI) * 0.16 : 0;
    const drop = el > 1.35 ? Math.min(1, (el - 1.35) / 0.6) : 0;
    // 第一人称镜头会随屏幕比例改变视野，以实际可见高度构图，避免举起后越过画面上沿。
    const lens = camera as THREE.PerspectiveCamera;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(lens.fov / 2)) * .5;
    gun.current.position.x = halfHeight * lens.aspect * .53;
    gun.current.position.y = halfHeight * (-1.15 + eased * .98 + recoil - drop * (died ? 1.4 : 1.1));
    gun.current.rotation.z = 0.5 + (1 - eased) * 0.7;

    const firing = el > 0.8 && el < 0.95;
    // 自己开枪也要有声音，和动画的开火帧对齐
    if (el >= 0.8 && !fired.current) {
      fired.current = true;
      sfx(died ? 'gun-shot' : 'gun-empty');
    }
    if (flash.current) {
      const mat = flash.current.material as THREE.MeshBasicMaterial;
      mat.opacity = firing ? 0.95 : 0;
      flash.current.scale.setScalar(firing ? 1.1 + Math.random() * 0.3 : 0.001);
    }
    if (light.current) light.current.intensity = firing ? 24 : 0;
  });

  return (
    <group ref={root}>
      {/* 第一人称自射：同一把左轮，枪口朝向自己，从画面下方抬起 */}
      <group ref={gun} name="PlayerShotRig" position={[0.22, 0.16, -0.5]} rotation={[0, 0, 0.12]}>
        {/* 枪管朝左（指向画面中心），斜着顶过来 —— 之前这里是绕 Z 转 90°，
            枪是竖直举着的，看着像「举枪示意」而不是自射 */}
        <group position={[0.02, -0.02, 0]}>
          <Revolver flashRef={flash} scale={0.34} flip tilt={-0.55} />
        </group>
        <pointLight ref={light} position={[0, 0.24, 0]} intensity={0} distance={3} color="#ffb347" />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* 手里的牌（跟随镜头）                                                 */
/* ------------------------------------------------------------------ */

/** 将角色掌缘、牌扇和点选区域固定在同一套镜头坐标中。 */
function HandInView({
  deckCount,
  species,
  releaseKey,
  poses,
  back,
  cards,
  selected,
  interactive,
  onSelect,
  dealKey,
  collectKey,
}: {
  deckCount: number;
  species?: Character['species'];
  releaseKey?: string;
  poses: Map<string, HandCardPose>;
  back: THREE.Texture;
  cards: PlayerView['me']['hand'];
  selected: string[];
  interactive: boolean;
  onSelect: (id: string) => void;
  /** 轮次或手牌批次变化时重放发牌动画 */
  dealKey: number;
  /** 递增时把手里的牌收走 */
  collectKey: number;
}) {
  const root = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const grip = useRef<THREE.Group>(null);
  // 手腕跟随牌扇中央，单张被抽高时其余手牌继续由同一处夹住。
  const gripPose = useMemo(() => ({
    heldPosition: new THREE.Vector3(), heldRotation: new THREE.Quaternion(), selection: 0,
  }), []);
  // 只在玩家实际打牌时启动松指；选择、撤回和对手出牌都不触发。
  const releasePose = useRef({ key: releaseKey, time: 1, open: 0, stackDepth: 0, deal: dealKey });
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const landed = useRef<Set<string>>(new Set());
  const dealAt = useRef(-1);
  const seenKey = useRef(-1);
  const deckWorld = useMemo(() => new THREE.Vector3(DECK_CENTER[0], DECK_CENTER[1] + deckCount * CARD_T, DECK_CENTER[2]), [deckCount]);
  // 用同一副实体牌从桌堆飞到手中，复用姿态运算所需的临时对象。
  const dealPose = useMemo(() => ({
    deck: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, -.3, 0)),
    face: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), FAN.tilt),
    inverseFace: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -FAN.tilt),
    zAxis: new THREE.Vector3(0, 0, 1), offset: new THREE.Vector3(),
    target: new THREE.Quaternion(), current: new THREE.Quaternion(),
  }), []);
  const collectAt = useRef(-1);
  const seenCollect = useRef(-1);
  /** 上一帧的手牌数量：收牌动画用它决定飞走几张（cards 会立刻变成新牌） */
  const lastCount = useRef(cards.length);
  const [collectCount, setCollectCount] = useState(0);
  /** 收牌之后、发牌之前，手牌一律不显示。
   *  状态放在 store 里，重开/换角色时能和其他 UI 状态一起原子重置。 */
  const handHidden = useGame((st) => st.handHidden);
  /** 结算演出期间手牌让开，否则举枪/开枪全被自己的牌挡着 */
  // 注意：质疑一发生 phase 就变 round_end 了，不能拿它当判据 ——
  // 那样翻牌还没演，玩家手里的牌就先消失了。
  // revealAt 是「演出播完、结算面板要出来」的时刻，用这个才准。
  // revealAt 是「结算面板该出现的时刻」。它可能因为各种中断路径残留下来，
  // 所以这里加一个时间窗口：超过 8 秒就当它已经失效，否则手牌会永久被隐藏。
  const inReveal = useGame((st) => st.revealAt !== null && gameNow() < st.revealAt + 8000);

  useEffect(() => {
    if (collectKey <= 0) return;
    useGame.setState({ handHidden: true });
    // 兜底：手牌隐藏后最多 3.5 秒必须回来。
    // 之前只在 dealKey 变化时解除，一旦「收牌窗口内重开/换角色」导致发牌信号没触发，
    // 手牌会整轮不渲染 —— 玩家看不到牌，只能盲打。
    const t = setGameTimeout(() => useGame.setState({ handHidden: false }), 3500);
    return () => clearGameTimeout(t);
  }, [collectKey]);

  useEffect(() => {
    if (dealKey >= 0) useGame.setState({ handHidden: false });
  }, [dealKey]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // 每帧把自己的变换对齐到摄像机：牌被「举」在手里，转头时跟着走
  useFrame((state, delta) => {
    const g = root.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    // 牌桌镜头可以拉近或转头；保持手牌在玩家视野中的尺寸独立于桌面焦距。
    const fov = (camera as THREE.PerspectiveCamera).fov;
    // 六名玩家角色共用前景取景。手与牌一起缩小，保留指腹接触和按真实牌面投影的点击区。
    const handFov = state.size.width < state.size.height ? 93 : 84;
    const handScale = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(handFov / 2));
    g.scale.setScalar(handScale);
    g.translateZ(-FAN.dist * (1 - handScale));
    // 横屏向下留出桌面已出牌的轮廓，位移按当前视锥的屏幕高度换算。
    if (state.size.width >= state.size.height) {
      const halfView = FAN.dist * Math.tan(THREE.MathUtils.degToRad(fov / 2));
      // 手牌由左手托住，横屏向左让出台面三张牌；竖屏本身有足够的垂直间隔。
      g.translateX(-.66 * halfView);
      g.translateY(-.08 * halfView);
    }
    // 围绕牌扇下沿转腕，让纸面略朝玩家倾斜，手、袖子及整叠牌共用这次旋转。
    g.translateY(FAN.baseY * handScale);
    g.translateZ(-FAN.dist * handScale);
    g.rotateY(.14);
    g.rotateX(-.19 + .07 * gripPose.selection);
    g.translateZ(FAN.dist * handScale);
    g.translateY(-FAN.baseY * handScale);
    g.updateWorldMatrix(true, false);
    // 前景手牌和实体飞牌使用同一条相机射线。预留最外侧下角在真实牌尺寸下的桌面净空，
    // 即使立即确认出牌，也能保持首帧投影，而不用在飞牌创建时把牌从桌布里突然提起。
    const physicalScale = handScale * FAN.scale;
    const m = g.matrixWorld.elements;
    let lowest = Infinity;
    for (const i of [0, 4]) {
      for (const side of [-.5, .5]) {
        const [x, y, z] = fanPoint(i, 5, side, 0);
        const worldY = camera.position.y + (g.position.y - camera.position.y + m[1]! * x + m[5]! * y + m[9]! * z) / physicalScale;
        lowest = Math.min(lowest, worldY);
      }
    }
    if (lowest < CARD_SURFACE_Y + CARD_T) {
      g.position.y += (CARD_SURFACE_Y + CARD_T - lowest) * physicalScale;
      g.updateWorldMatrix(true, false);
    }
    // 以手掌所在的牌扇下缘为准，向玩家收回前臂；只沿桌面移动，落牌起点仍有相同净空。
    tmp.set(0, FAN.baseY, -FAN.dist).applyMatrix4(g.matrixWorld);
    const reachReduction = state.size.width < state.size.height ? .30 : .36;
    g.position.x += (camera.position.x - tmp.x) * reachReduction;
    g.position.z += (camera.position.z - tmp.z) * reachReduction;
    g.updateWorldMatrix(true, false);
    const now = state.clock.elapsedTime;
    if (grip.current) {
      const pose = releasePose.current;
      if (pose.deal !== dealKey) {
        pose.deal = dealKey;
        pose.key = releaseKey;
        pose.time = 1;
      }
      if (pose.key !== releaseKey) {
        pose.key = releaseKey;
        if (releaseKey !== undefined) pose.time = 0;
      }
      pose.time = Math.min(1, pose.time + delta * SPEED);
      // 抽出部分牌时短暂放松指腹，余指仍托住手牌；最后一张才完整松手。
      pose.open = (cards.length ? .08 : 1) * THREE.MathUtils.smoothstep(pose.time, 0, .12) * (1 - THREE.MathUtils.smoothstep(pose.time, .18, .47));
      grip.current.visible = !handHidden && !inReveal && (cards.length > 0 || pose.time < .47);
      const allSelected = cards.length > 0 && selected.length === cards.length;
      const blend = 1 - Math.exp(-18 * Math.min(delta, .08));
      gripPose.selection = THREE.MathUtils.lerp(gripPose.selection, allSelected ? 1 : 0, blend);
    }

    // ── 收手牌：旧牌从手里飞出屏幕下方 ──
    if (seenCollect.current !== collectKey) {
      seenCollect.current = collectKey;
      if (collectKey > 0) {
        setCollectCount(lastCount.current);
        collectAt.current = now;
        sfx('card-deal', 0.8);
      }
    }
    if (collectKey !== seenCollect.current) lastCount.current = cards.length;
    else lastCount.current = cards.length;

    const ct = now - collectAt.current;
    if (collectAt.current > 0 && ct < 0.52) {
      const ce = Math.min(1, ct / 0.46);
      // 收牌期间真实手牌全部隐藏
      cards.forEach((_, i) => {
        const cg = cardRefs.current[i];
        if (cg) cg.visible = false;
      });
      void ce;
      return;
    }
    if (collectAt.current > 0 && ct >= 0.52) {
      // 收完，允许后续发牌
      collectAt.current = -1;
      setCollectCount(0);
    }
    // ── 发牌：每张牌从桌上牌堆飞进手牌位 ──
    if (dealKey < 0) {
      cards.forEach((_, i) => {
        const cg = cardRefs.current[i];
        if (cg) cg.visible = false;
      });
      return;
    }
    if (seenKey.current !== dealKey) {
      seenKey.current = dealKey;
      dealAt.current = now;
      landed.current.clear();
    }
    const t0 = dealAt.current;
    const n = cards.length;

    cards.forEach((_, i) => {
      const cg = cardRefs.current[i];
      if (!cg) return;

      const [bx, by, bz] = fanBase(i, n);
      const delay = i * 0.085;
      const t = now - t0 - delay;

      if (t <= 0) {
        cg.visible = false;
        return;
      }
      cg.visible = true;

      const p = Math.min(1, t / 0.4);
      // 从牌堆平稳起动，抵达手牌位时把速度降到零。
      const e = THREE.MathUtils.smootherstep(p, 0, 1);

      // 落定之后：目标位置会随「张数变化」而变（出牌 → 扇形重排），
      // 这里用 lerp 平滑过去，否则每出一张牌整把手都会瞬移一下。
      if (p >= 1) {
        const k = cg.userData.hasHandPose ? 1 - Math.exp(-14 * Math.min(delta, .08)) : 1;
        cg.userData.hasHandPose = true;
        cg.position.x += (bx - cg.position.x) * k;
        cg.position.y += (by - cg.position.y) * k;
        cg.position.z += (bz - cg.position.z) * k;
        const targetRz = fanAngle(i, n);
        cg.rotation.x = 0;
        cg.rotation.z += (targetRz - cg.rotation.z) * k;
        cg.rotation.y += (0 - cg.rotation.y) * k;
        cg.scale.setScalar(cg.scale.x + (1 - cg.scale.x) * k);
        cg.visible = true;
        // 落定瞬间的「唰」：每张牌只响一次（之前这段在 return 之后，从未执行）
        const id = `${dealKey}-${i}`;
        if (!landed.current.has(id)) {
          landed.current.add(id);
          sfx('card-deal');
        }
        return;
      }

      // 以牌心计算起点和终点。将牌扇的近景投影还原到实体大小，抵达时再无缝交给近景网格。
      cg.userData.hasHandPose = false;
      const angle = fanAngle(i, n);
      tmp.set(bx - Math.sin(angle) * HALF, by + Math.cos(angle) * HALF, bz)
        .applyMatrix4(g.matrixWorld).sub(camera.position).divideScalar(physicalScale).add(camera.position);
      tmp.lerpVectors(deckWorld, tmp, e);
      tmp.y += Math.sin(p * Math.PI) ** 3 * .20;
      dealPose.target.setFromAxisAngle(dealPose.zAxis, angle).premultiply(g.quaternion).multiply(dealPose.face);
      dealPose.current.slerpQuaternions(dealPose.deck, dealPose.target, THREE.MathUtils.smoothstep(p, .08, .94));
      tmp.y = Math.max(tmp.y, CARD_SURFACE_Y + cardHalfHeight(dealPose.current, 1));
      g.worldToLocal(tmp);
      cg.quaternion.copy(g.quaternion).invert().multiply(dealPose.current).multiply(dealPose.inverseFace);
      cg.scale.setScalar(1 / physicalScale);
      // Card3D 的原点在上方半张牌处，反向减去这段位移才能让牌心准确落在轨迹上。
      dealPose.offset.set(0, HALF, 0).applyQuaternion(cg.quaternion).multiplyScalar(cg.scale.x);
      cg.position.copy(tmp).sub(dealPose.offset);
    });
    const wrist = grip.current;
    if (wrist) {
      if (n) {
        // 新手模夹住牌扇中央的共同底边。抽走外侧牌时，手腕不会跟着换到另一张牌。
        const [, baseY, frontZ] = fanBase(n - 1, n);
        const arrival = now - t0 - .4;
        const stack = releasePose.current;
        const depth = THREE.MathUtils.clamp((n - 1) / 4, 0, 1);
        stack.stackDepth = arrival < 0
          ? depth
          : THREE.MathUtils.damp(stack.stackDepth, depth, 22, Math.min(delta, .08));
        const reach = 1 - THREE.MathUtils.smootherstep(arrival, -.23, 0);
        wrist.scale.setScalar(FAN.scale);
        gripPose.heldPosition.set(0, baseY + HALF + FAN.selectionLift * gripPose.selection, frontZ);
        gripPose.heldRotation.copy(dealPose.face);
        wrist.position.copy(gripPose.heldPosition);
        wrist.position.x -= .04 * reach;
        wrist.position.y -= .38 * reach;
        wrist.position.z += .04 * reach;
        wrist.quaternion.copy(gripPose.heldRotation);
        wrist.rotateX(.15 * reach);
        wrist.visible &&= arrival >= -.23;
        if (arrival < 0) releasePose.current.open = .65 * reach;
      } else {
        // 末牌脱手后保留最后一次真实腕位，再将空手收回。
        wrist.position.copy(gripPose.heldPosition);
        const retract = THREE.MathUtils.smootherstep(releasePose.current.time, .10, .47);
        wrist.position.x -= .035 * retract;
        wrist.position.y -= .30 * retract;
        wrist.position.z += .045 * retract;
        wrist.quaternion.copy(gripPose.heldRotation);
        wrist.rotateX(.18 * retract);
      }
    }
    // 摄像机先就位；牌扇与松指参数在子网格采样前更新。
  }, -.5);

  return (
    <group ref={root}>
      {species && (
        <group ref={grip} name="PlayerCardGrip" visible={false}>
          <PlayerCardGrip species={species} releasePose={releasePose} />
        </group>
      )}

      {/* 收牌：用牌背下落，数量和上一轮手牌一致 */}
      {collectCount > 0 && (
        <CollectHandGhosts back={back} count={collectCount} active={collectCount > 0} />
      )}

      {!handHidden && !inReveal && cards.map((card, i) => (
        <group
          key={card.id}
          name={`HandCard-${card.id}`}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
        >
          <Card3D
            card={card}
            backTexture={back}
            handHitId={card.id}
            meshRef={(mesh) => {
              // 保留渲染器更新的世界矩阵；移除手牌后仍可取得它最后一次真实显示的姿态。
              if (mesh) poses.set(card.id, { matrix: mesh.matrixWorld, index: i });
            }}
            position={[0, HALF, 0]}
            pitch={FAN.tilt}
            faceUp
            selected={selected.includes(card.id)}
            interactive={interactive}
            scale={FAN.scale}
            onClick={() => onSelect(card.id)}
          />
        </group>
      ))}
    </group>
  );
}

/** 测试读取坐标时才投影牌角，使用该牌最后绘制的真实矩阵。 */
function HandProbe({ cards, poses }: { cards: PlayerView['me']['hand']; poses: Map<string, HandCardPose> }) {
  const { size, camera } = useThree();
  useEffect(() => {
    Object.defineProperty(window, '__HAND__', {
      configurable: true,
      get: () => cards.flatMap((card, i) => {
        const pose = poses.get(card.id);
        if (!pose) return [];
        const pt = new THREE.Vector3(-.38 * CARD_W, CARD_T / 2, -.32 * CARD_D)
          .applyMatrix4(pose.matrix).project(camera);
        return [{ i, x: (pt.x + 1) * size.width / 2, y: (1 - pt.y) * size.height / 2 }];
      }),
    });
    return () => { Reflect.deleteProperty(window, '__HAND__'); };
  }, [cards, poses, camera, size.width, size.height]);
  return null;
}

/* ------------------------------------------------------------------ */

function moodOf(view: PlayerView, seat: number): Mood {
  if (!view.seats[seat]?.alive) return 'dead';
  if (view.winnerSeat === seat) return 'win';
  const reveal = view.lastReveal;
  if (reveal && reveal.playSeat === seat && !reveal.truthful) return 'shock';
  if (reveal && reveal.challengerSeat === seat) return 'think';
  if (view.phase === 'turn' && view.turnSeat === seat) return 'think';
  return 'idle';
}

export function TableScene({
  view,
  characters,
  selected,
  onSelect,
  resetSignal = 0,
}: {
  view: PlayerView;
  characters: Character[];
  selected: string[];
  onSelect: (id: string) => void;
  resetSignal?: number;
}) {
  const total = view.seats.length;
  // 每位对手的手骨由自己的模型实例登记，换角色和换局都不共享骨骼。
  const hands = useMemo(() => Array.from({ length: total }, (): PlayingHand => ({})), [total]);
  const poses = useRef(new Map<string, HandCardPose>()).current;
  // 只读取自己的出牌明细；按原扇位排序，多张一起飞时轨迹保持左右顺序。
  const ownPending = useGame((state) => state.game.pendingPlay?.seat === view.seat ? state.game.pendingPlay.cards : null);
  const outgoing = useMemo(() => ownPending?.slice().sort((a, b) =>
    (poses.get(a.id)?.index ?? 0) - (poses.get(b.id)?.index ?? 0)), [ownPending, poses]);
  const pending = view.pendingPlay;
  const playKey = pending ? `${view.round}-${pending.seat}-${view.seats[pending.seat]?.cardCount}` : undefined;
  const seatRadius = SEAT_R + Math.max(0, total - 4) * 0.14 - Math.max(0, 4 - total) * 0.16;
  const me = characters[view.seat];
  const reveal = view.lastReveal;
  // 只有翻牌网格读取待演出的牌；其余角色与界面继续读取已公开视图。
  const tableReveal = useGame(state => state.game.lastReveal);
  const hearingChallenge = useGame(state => state.awaitingCardFlip);
  const mismatch = tableReveal ? firstMismatch(tableReveal.cards, view.targetRank) : -1;
  const punished =
    reveal && (view.phase === 'round_end' || view.phase === 'game_end') ? reveal.punishedSeat : null;
  // 谁正在说话 —— 让玩家一眼看出这句台词归谁
  const speakingSeat = useGame((st) => st.speakingSeat);
  const thinkingSeat = useGame((st) => st.thinkingSeat);
  // 轮到谁才读谁的上一轮翻牌；语音高亮、相机转动不会重建记忆。
  const tableReaction = useMemo(() => readTableReaction(view), [view]);
  const tenseSeat = useGame((st) => st.tenseSeat);
  // 举枪由 SHOT 事件驱动：质疑 → 翻牌 → 才轮到他举枪
  const shotSeat = useGame((st) => st.shotSeat);
  // 开枪时镜头只「转向」受罚者，不推进距离（推进会怼脸）
  const focusSeat = shotSeat !== null && shotSeat !== view.seat ? shotSeat : null;
  const dealSignal = useGame((st) => st.dealSignal);
  const collectHand = useGame((st) => st.collectHand);

  // 收牌：上一轮摊在桌上的牌，在新一轮开始时飞回牌堆
  const lastTableCards = useRef<{ cards: typeof reveal extends null ? never : NonNullable<typeof reveal>['cards']; round: number } | null>(null);
  const [collect, setCollect] = useState<{ cards: NonNullable<typeof reveal>['cards']; round: number } | null>(null);

  /** 已经开始收牌的轮次：单调保护，同一轮只收一次 */
  const collectedRound = useRef(-1);
  /** 收牌定时器句柄：放在 ref 里，不随 effect 重跑被清掉 */
  const collectTimers = useRef<GameTimer[]>([]);

  useEffect(() => {
    const onTable = reveal && (view.phase === 'round_end' || view.phase === 'game_end');
    if (onTable) {
      lastTableCards.current = { cards: reveal!.cards, round: view.round };
      setCollect(null);
      return;
    }

    // 离开结算 → 上一轮还有牌摊着 → 播收牌
    // 只在「轮次前进」时收牌。重开会把 round 从 5 打回 1，
    // 那种情况是全新一局，不该播旧局的收牌动画（否则新局开头有旧牌残像）。
    const pending = lastTableCards.current;
    if (pending && pending.round < view.round && collectedRound.current < pending.round) {
      collectedRound.current = pending.round;
      lastTableCards.current = null;
      // 等结算面板淡出（约 0.3s）再收牌，否则被面板挡着看不见。
      // 定时器句柄存在 ref 里：这个 effect 会因 reveal/phase 变化重跑，
      // 如果放局部变量，cleanup 会把刚排好的收牌直接取消掉（动画偶发丢失）。
      collectTimers.current.forEach(clearGameTimeout);
      collectTimers.current = [
        setGameTimeout(() => setCollect(pending), 320),
        setGameTimeout(() => setCollect(null), 1500),
      ];
      return;
    }
    // 新局（round 比记录的小）：记录直接作废，别留着下次误触发
    if (pending && pending.round > view.round) {
      lastTableCards.current = null;
    }
  }, [reveal, view.phase, view.round]);

  // 卸载时清掉收牌定时器
  useEffect(
    () => () => {
      collectTimers.current.forEach(clearGameTimeout);
      collectTimers.current = [];
    },
    [],
  );
  const selfShooting = shotSeat === view.seat;
  // 取第一人称实际眼位，侧座狐狸转头时始终朝向玩家所在的位置。
  const playerEye = seatPos(view.seat, total, seatRadius + EYE_RADIUS_OFFSET, view.seat);
  // 质疑者方位只来自公开座位；玩家用真实眼位，电脑用其坐姿中心。
  const challengerSeat = hearingChallenge ? tableReveal?.challengerSeat : undefined;
  const challengerPos = challengerSeat === undefined ? null
    : challengerSeat === view.seat ? playerEye
    : seatPos(challengerSeat, total, seatRadius, view.seat);

  // 等待时观察正在说话或轮到行动的人；旁观反应只使用全桌都能看到的信息。
  const focusActor = view.phase === 'turn' && shotSeat === null ? speakingSeat ?? view.turnSeat : null;
  const focusPosition = focusActor == null ? null : seatPos(focusActor, total, seatRadius, view.seat);

  return (
    <>
      <color attach="background" args={['#0d0704']} />

      <fog attach="fog" args={['#0d0704', 12, 26]} />
      <Lights />
      <Table3D />
      <FirstPersonCamera
        seat={view.seat}
        total={total}
        seatRadius={seatRadius}
        resetSignal={resetSignal}
        focusSeat={focusSeat}
      />

      {view.seats
        .map((s) => {
          const character = characters[s.seat];
          if (!character) return null;
          const isSelf = s.seat === view.seat;
          // 坐姿按性格：胆大的人往前凑，多疑的人往后靠（离桌心 ±0.14）
          const aggression = character.personality.aggression;
          const lean = (aggression - 0.5) * 0.28;
          const pos = seatPos(s.seat, total, seatRadius - lean, view.seat);
          const rotationY = Math.atan2(-pos[0], -pos[2]);
          // 立绘实宽的一半：脚下光晕按人物体量给，别一律一个大小
          const spec = CHARACTER_STANDEES[character.species];
          const halfW = spec ? (spec.height * spec.aspect) / 2 : 0.45;
          if (isSelf) return null;
          return (
            <group key={s.seat}>
              <Actor
                hand={hands[s.seat]!}
                pressure={
                  // 只在「手里还有牌但快出完」时紧张；0 张是已经打完，不算压力
                  s.cardCount > 0 && s.cardCount <= 3 ? (3 - s.cardCount) / 2 : 0
                }
                thinking={thinkingSeat === s.seat}
                reaction={thinkingSeat === s.seat && view.turnSeat === s.seat ? tableReaction : null}
                tense={tenseSeat === s.seat}
                gaze={focusPosition && focusActor !== s.seat ? THREE.MathUtils.euclideanModulo(
                  Math.atan2(focusPosition[0] - pos[0], focusPosition[2] - pos[2]) - rotationY + Math.PI, 2 * Math.PI,
                ) - Math.PI : 0}
                character={character}
                observedPlay={pending && pending.seat !== s.seat ? playKey : undefined}
                playSignal={pending?.seat === s.seat ? playKey : undefined}
                challenge={!!tableReveal && tableReveal.challengerSeat === s.seat}
                position={
                  view.phase === 'turn' && view.turnSeat === s.seat
                    ? [pos[0] * 0.985, pos[1], pos[2] * 0.985]
                    : pos
                }
                rotationY={rotationY}
                challengerYaw={challengerPos && tableReveal?.playSeat === s.seat ? THREE.MathUtils.euclideanModulo(
                  Math.atan2(challengerPos[0] - pos[0], challengerPos[2] - pos[2]) - rotationY + Math.PI, 2 * Math.PI,
                ) - Math.PI : undefined}
                playerYaw={THREE.MathUtils.euclideanModulo(
                  Math.atan2(playerEye[0] - pos[0], playerEye[2] - pos[2]) - rotationY + Math.PI, 2 * Math.PI,
                ) - Math.PI}
                alive={s.alive}
                isTurn={view.phase === 'turn' && view.turnSeat === s.seat}
                mood={moodOf(view, s.seat)}
                shooting={shotSeat === s.seat}
                shotDied={shotSeat === s.seat && tableReveal?.died === true}
                speaking={speakingSeat === s.seat}
              />

              {/* 待机可见掌中暗牌。打出的同一套牌由下方的飞牌组件接管。 */}
              {s.alive && s.cardCount > 0 && view.phase === 'turn' && (
                <OpponentCard hand={hands[s.seat]!} showAfter={pending?.seat === s.seat ? playKey : undefined} yaw={Math.atan2(-pos[0], seatRadius - pos[2])}
                  back={characterBackTexture(character.id)} />
              )}

              {/* 枪独立渲染：用角色的世界坐标，避免侧面座位被 rotationY 转偏 */}
              <OpponentGun
                position={[pos[0], 0, pos[2]]}
                height={CHARACTER_STANDEES[character.species]?.height ?? 1.9}
                shooting={shotSeat === s.seat}
                // 中弹与否只能看引擎给的 died：撒谎被抓也可能只是空枪
                died={reveal?.punishedSeat === s.seat && reveal?.died === true}
                visible={!!s.alive || shotSeat === s.seat}
              />
              {!isSelf && (
              <NameTag
                speaking={speakingSeat === s.seat}
                name={s.name}
                count={s.cardCount}
                accent={character.palette.accent}
                alive={s.alive}
                pending={view.pendingPlay?.seat === s.seat}
                position={[pos[0], (CHARACTER_STANDEES[character.species]?.height ?? 1.9) + 0.14, pos[2]]}
              />
              )}
              {!isSelf && (
                <OpponentStack viewer={view.seat} seat={s.seat} hand={hands[s.seat]!} back={characterBackTexture(character.id)} count={s.cardCount} total={total} radius={seatRadius} />
              )}
              {!isSelf && <SeatToken viewer={view.seat} seat={s.seat} total={total} radius={seatRadius} character={character} />}
              {/* 脚下接地：接触阴影 + 角色主色光晕，人不再贴在虚空里 */}
              {!isSelf && (
                <GroundPool x={pos[0]} z={pos[2]} radius={halfW * 1.1} accent={character.palette.accent} />
              )}
              {/* 轮廓光：让角色从暗背景里「跳」出来，轮廓更清楚 */}
              <pointLight
                position={[pos[0] * 1.16, 2.2, pos[2] * 1.16]}
                intensity={7}
                distance={3.2}
                decay={2}
                color={character.palette.accent}
              />
            </group>
          );
        })}

      {/* 桌面道具：全部来自 Codex 生成的素材 */}
      <PropImage src={asset('assets/props/bottle.png')} size={0.42} position={[-1.15, TABLE_TOP + 0.2, 0.75]} />
      <PropImage src={asset('assets/props/mug.png')} size={0.26} position={[-0.82, TABLE_TOP + 0.12, 1.02]} />
      <PropImage src={asset('assets/props/lantern.png')} size={0.34} position={[1.55, TABLE_TOP + 0.16, 0.95]} />
      <PropImage src={asset('assets/props/chip.png')} size={0.13} position={[-0.15, TABLE_TOP + 0.06, 0.62]} />
      <PropImage src={asset('assets/props/chip.png')} size={0.12} position={[0.12, TABLE_TOP + 0.06, 0.5]} />
      <PropImage src={asset('assets/props/die.png')} size={0.11} position={[0.35, TABLE_TOP + 0.05, 0.7]} />
      <PropImage src={asset('assets/props/dice.png')} size={0.1} position={[0.55, TABLE_TOP + 0.05, 0.55]} />
      <PropImage src={asset('assets/props/bullet.png')} size={0.12} position={[-0.45, TABLE_TOP + 0.05, 0.82]} tilt={-0.4} />

      {/* 发牌堆按剩余张数叠放，每层正好一张纸厚。 */}
      {Array.from({ length: view.deckCount }).map((_, i) => (
        <Card3D
          key={`deck-${i}`}
          position={[DECK_CENTER[0], DECK_CENTER[1] + i * CARD_T, DECK_CENTER[2]]}
          rotationY={-0.3}
          faceUp={false}
        />
      ))}

      {/* 证明谎言只需第一张不符牌；真话需到最后一张翻完才能成立。 */}
      {tableReveal && (view.phase === 'round_end' || view.phase === 'game_end')
        ? tableReveal.cards.map((card, i) => (
            <PlayedCard
              key={`${view.round}-${card.id}`}
              card={card}
              back={characterBackTexture(characters[tableReveal.playSeat]?.id)}
              position={tableCardSlot(i, tableReveal.cards.length)}
              index={i}
              mark={reveal ? mismatch === i ? 'lie' : mismatch < 0 ? 'truth' : undefined : undefined}
              label={reveal && mismatch === i ? '与声明不符' : reveal && mismatch < 0 && i === Math.floor(tableReveal.cards.length / 2) ? '声明属实' : undefined}
            />
          ))
        : view.pendingPlay &&
          Array.from({ length: view.pendingPlay.count }).map((_, i) => {
            const count = view.pendingPlay!.count;
            const mine = view.pendingPlay!.seat === view.seat;
            const to = tableCardSlot(i, count);
            if (!mine) {
              const seat = view.pendingPlay!.seat;
              const pos = seatPos(seat, total, seatRadius - .35, view.seat);
              // 模型成功时每张牌都跟随掌心至松手帧；后备位置仅在模型没加载时使用。
              return <OpponentCard key={`${playKey}-${i}`} hand={hands[seat]!} playKey={playKey}
                index={i} count={count} yaw={Math.atan2(-pos[0], seatRadius - pos[2])}
                back={characterBackTexture(characters[seat]?.id)}
                fallback={[pos[0], TABLE_TOP + .45, pos[2]]} target={to} />;
            }
            const card = outgoing?.[i];
            return card && <SelfPlayedCard key={playKey + card.id} card={card} pose={poses.get(card.id)}
              back={characterBackTexture(characters[view.seat]?.id)} target={to} fanOffset={i - (count - 1) / 2} />;
          })}

      {/* 终局：给赢家打一束顶光，把注意力收过去 */}
      {view.phase === 'game_end' && view.winnerSeat !== null && (() => {
        const wp = seatPos(view.winnerSeat, total, seatRadius, view.seat);
        return (
          <spotLight
            position={[wp[0] * 0.6, 3.6, wp[2] * 0.6]}
            target-position={[wp[0], 0.6, wp[2]]}
            angle={0.45}
            penumbra={0.7}
            intensity={18}
            distance={9}
            color="#ffd7a0"
          />
        );
      })()}

      {collect && (
        <CollectCards
          cards={collect.cards}
          round={collect.round}
          pilePosition={[DECK_CENTER[0], DECK_CENTER[1] + view.deckCount * CARD_T, DECK_CENTER[2]]}
        />
      )}

      <HandInView
        deckCount={view.deckCount}
        species={me?.species}
        releaseKey={pending?.seat === view.seat ? playKey : undefined}
        poses={poses}
        back={characterBackTexture(me?.id)}
        cards={view.me.hand}
        selected={selected}
        interactive={view.phase === 'turn' && view.turnSeat === view.seat}
        onSelect={onSelect}
        dealKey={dealSignal}
        collectKey={collectHand}
      />
      <HandProbe cards={view.me.hand} poses={poses} />
      {ENABLE_SCENE_PROBE && <SceneProbe />}
      <SelfGun active={selfShooting} died={!!reveal?.died} />
    </>
  );
}
