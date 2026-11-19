import { setGameTimeout, clearGameTimeout } from '../gameClock';
import { useFrame } from '@react-three/fiber';
import { useGameGLTF } from './useGameGLTF';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { asset } from '../data/assetPath';
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Character } from '../data/characters';
import { CharStandee } from './CharStandee';
import { PropImage } from './PropImage';
import { characterModelPath, CHARACTER_STANDEES, MODEL_RENDER_HEIGHT } from './models';

import type { PlayingHand } from './OpponentCard';
import { consumeTableReaction, SPEED } from '../store';
import { foxGazeClips } from './foxGaze';
import { glowTexture } from './sceneTextures';
import { mageFingertip, makeReactionArm, reactionAngles, reactionArmWeight, type TableReaction } from './tableReaction';

// 倾角使用弧度，延迟使用秒。长喙侧听、猫的快瞥与法师的慢抬头保留不同节奏。
const listeningStyle = {
  fox:   { delay: 0,    speed: 8,  limit: .85, pitch: -.09, tilt: 0,    down: 0 },
  raven: { delay: .08,  speed: 10, limit: .94, pitch: -.04, tilt: .12,  down: .18 },
  boar:  { delay: .04,  speed: 8,  limit: .68, pitch: -.17, tilt: .02,  down: .16 },
  cat:   { delay: .075, speed: 16, limit: .89, pitch: -.06, tilt: -.10, down: .21 },
  mage:  { delay: .10,  speed: 5,  limit: .69, pitch: -.18, tilt: .03,  down: .20 },
  rogue: { delay: .03,  speed: 12, limit: .62, pitch: -.04, tilt: -.04, down: .12 },
};

/** 临界阻尼的解析步进。目标改变时保留角速度，转头换向会先减速再回转。 */
function easeAngle(axis: 'angle' | 'lift' | 'roll', velocity: Record<'angle' | 'lift' | 'roll', number>,
  current: number, target: number, frequency: number, dt: number) {
  const offset = current - target;
  const slope = velocity[axis] + frequency * offset;
  const decay = Math.exp(-frequency * dt);
  velocity[axis] = (velocity[axis] - frequency * slope * dt) * decay;
  return target + (offset + slope * dt) * decay;
}

export type Mood = 'idle' | 'think' | 'shock' | 'win' | 'dead';

/** 单个模型加载失败时保留原有立绘，避免中断整个牌桌。 */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// 原型椅模型从底到顶的 43.3% 处是椅面；深度取椅面中央略靠前的承托点。
const CHAIR_HEIGHT = 1.15;
const CHAIR_CENTER_Y = 0.58;
const CHAIR_SURFACE_Y = CHAIR_CENTER_Y + (0.433 - 0.5) * CHAIR_HEIGHT;

/** 加载独立骨架实例并播放与游戏状态对应的角色动作。 */
function AnimatedAnimal({ species, height, action, playSignal, observedPlay, consideringHand, seated, chairDepth, seatAngle, playerYaw, challengerYaw, attentionYaw, torsoLean, reaction, hand, onPlayEnd }: {
  species: Character['species']; height: number; action: string; playSignal?: string; observedPlay?: string; consideringHand: boolean; seated: boolean; chairDepth: number; seatAngle: number; playerYaw: number; challengerYaw?: number; attentionYaw?: number; torsoLean: number; reaction: TableReaction | null; hand: PlayingHand; onPlayEnd: (key: string) => void;
}) {
  // 牌桌按角色加载带坐标锚点的资源，浪人使用其独立坐姿。
  const humanSeat = seated && (species === 'mage' || species === 'rogue');
  const modelPath = characterModelPath(species, seated);
  const gltf = useGameGLTF(asset(`assets/models/characters/${modelPath}.glb`));
  const model = useMemo(() => {
    const scene = cloneSkeleton(gltf.scene);
    // 缩放：用「实测渲染高度」反推（各模型根节点自带的缩放差了 100 倍）
    // 坐姿资源的原始高度由浏览器实际包围盒测得。
    const renderH = humanSeat ? (species === 'mage' ? 1.77 : 2) : (MODEL_RENDER_HEIGHT[species] ?? 1.9);
    const scale = height / renderH;
    scene.scale.multiplyScalar(scale);

    scene.updateMatrixWorld(true);
    const contact = seated && scene.getObjectByName('SeatContact');
    if (contact) {
      // 模型锚点位于臀部或袍底的承托面。三个方位共用椅子局部坐标，旋转后仍然贴合。
      const anchor = contact.getWorldPosition(new THREE.Vector3());
      scene.position.set(-anchor.x, CHAIR_SURFACE_Y - anchor.y, chairDepth + 0.10 - anchor.z);
    } else {
      scene.position.y = -new THREE.Box3().setFromObject(scene).min.y;
    }
    return scene;
  }, [gltf.scene, height, humanSeat, species, chairDepth, seated]);
  const torso = useMemo(() => model.getObjectByName('SeatedTorsoPivot'), [model]);
  const head = useMemo(() => !torso && seated ? model.getObjectByName('head') : undefined, [model, torso, seated]);
  const nod = useRef(0);
  // 叠加在身体上半部，保持椅面接触；浪人独立头部则使用原头骨。
  const memoryJoint = torso ?? head;
  const pose = useMemo(() => ({ arm: undefined as ReturnType<typeof makeReactionArm> | undefined }), [model]);
  const spark = useRef<THREE.Sprite>(null);
  const fingertip = useMemo(() => ({ anchor: undefined as THREE.Object3D | null | undefined }), [model]);
  const overlay = useMemo(() => ({
    elapsed: 1, angles: new THREE.Euler(), rotation: new THREE.Quaternion(),
  }), [model]);
  const event = reaction?.revealSeq;
  useLayoutEffect(() => {
    if (event !== undefined && consumeTableReaction(event)) {
      overlay.elapsed = 0;
    }
  }, [event, overlay]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  // 仅坐姿狐狸的出牌和质疑加入视线，原动画资源仍由所有座位安全共享。
  const clips = useMemo(() => seated && species === 'fox'
    ? foxGazeClips(gltf.animations, playerYaw) : gltf.animations, [seated, species, gltf.animations, playerYaw]);
  // 在模型自身的正前方定义视线；浪人的独立头发蒙皮与头骨使用同一转角。
  const listener = useMemo(() => {
    if (!seated) return null;
    const names = species === 'fox' ? ['mixamorigHead'] : species === 'rogue' ? ['head', 'SeatedHeadPivot'] : ['head'];
    const joints = names.flatMap(name => {
      const bone = model.getObjectByName(name);
      return bone?.parent ? [{ bone, rest: new THREE.Quaternion() }] : [];
    });
    // 次级动作跟在转头之后；肩部和收腕各自绕原骨骼旋转，髋腿保持就座。
    const support = species === 'raven' || species === 'boar' ? model.getObjectByName('spine')
      : species === 'rogue' ? model.getObjectByName('tableForearm_R') : undefined;
    return { joints, support, supportRest: new THREE.Quaternion(), velocity: { angle: 0, lift: 0, roll: 0 }, follow: 0, angle: 0, lift: 0, roll: 0, elapsed: 0, heard: false, returning: 0,
      consideredFor: 0, handPoint: new THREE.Vector3(), eyePoint: new THREE.Vector3(),
      seenPlay: undefined as string | undefined, sincePlay: Infinity, tableLean: 0, active: false, parentFrame: new THREE.Quaternion(), seatFrame: new THREE.Quaternion(),
      applied: new THREE.Quaternion(), rotation: new THREE.Quaternion(), angles: new THREE.Euler(0, 0, 0, 'YXZ') };
  }, [model, seated, species]);
  const current = useRef<THREE.AnimationAction | null>(null);
  // 只有播放出牌动作时，新出牌标识才需要重启动画；其他反应不受其清空影响。
  const playKey = action === 'play' ? playSignal : undefined;
  useLayoutEffect(() => {
    nod.current = 0;
    hand.anchor = model.getObjectByName('CardRelease');
    hand.gripFrame = model.getObjectByName('GripFrame');
    return () => { hand.gripFrame = undefined; hand.anchor = undefined; hand.play = undefined; hand.key = undefined; hand.finished = undefined; };
  }, [model, hand]);
  useFrame((_state, delta) => {
    // 浪人沿用原骨架，用头部轻点回应说话；先撤销上一帧叠加，防止姿势累积。
    // 每帧先撤销上一帧的记忆反应，再由动画混合器正常更新原动作。
    let arm = pose.arm;
    if (arm?.applied) {
      arm.upper.quaternion.copy(arm.restUpper);
      arm.lower.quaternion.copy(arm.restLower);
      arm.applied = false;
    }
    if (spark.current) spark.current.visible = false;
    if (memoryJoint) memoryJoint.quaternion.multiply(overlay.rotation.invert());
    overlay.rotation.identity();
    if (head) head.rotateX(-nod.current);
    if (listener?.active) {
      for (const { bone, rest } of listener.joints) bone.quaternion.copy(rest);
      listener.support?.quaternion.copy(listener.supportRest);
    }
    mixer.update(delta * SPEED);
    if (listener) {
      const listening = challengerYaw !== undefined;
      const dt = delta * SPEED;
      const gesture = listeningStyle[species];
      if (listening && !listener.heard) listener.elapsed = 0;
      if (!listening && listener.heard) listener.returning = 1;
      listener.heard = listening;
      listener.elapsed += dt;
      listener.returning = Math.max(0, listener.returning - dt / .65);
      const alert = listening && listener.elapsed >= gesture.delay;
      // 坐着等牌时先观察行动者，偶尔低头看桌面，短暂停留后才抬头。
      // 座位相位与性格节奏错开，避免整桌同时点头。
      const waiting = !listening && listener.returning === 0 && action === 'idle' && attentionYaw !== undefined;
      const beat = THREE.MathUtils.euclideanModulo(mixer.time / (8 + 14 / gesture.speed) + seatAngle * .37 + gesture.limit, 1);
      const peek = waiting ? THREE.MathUtils.smoothstep(beat, .47, .58) * (1 - THREE.MathUtils.smoothstep(beat, .70, .84)) : 0;
      // 听到出牌后先看向桌面，停留片刻才重新观察对手；速度和偏头习惯沿用各角色的性格。
      if (observedPlay !== listener.seenPlay) {
        listener.seenPlay = observedPlay;
        listener.sincePlay = observedPlay ? -gesture.delay - .6 / gesture.speed : Infinity;
      }
      listener.sincePlay += dt;
      const age = listener.sincePlay;
      const tracking = waiting ? THREE.MathUtils.smoothstep(age, 0, .32) *
        (1 - THREE.MathUtils.smoothstep(age, .68, 1.35 + 1 / gesture.speed)) : 0;
      // 视线先到，肩背随后略探再放松；只绕躯干承托点转动，不挪髋部。
      listener.tableLean = THREE.MathUtils.damp(listener.tableLean, tracking * (.035 + gesture.down * .14), gesture.speed * .45, dt);
      // 轮到自己时先扫过手中真实的牌，再抬眼观察对面。转角由本角色的头骨与握点决定。
      listener.consideredFor = consideringHand ? listener.consideredFor + dt : 0;
      let study = 0, handYaw = 0, handPitch = 0;
      const eyes = listener.joints[0]?.bone;
      if (waiting && consideringHand && eyes && hand.gripFrame) {
        study = THREE.MathUtils.smoothstep(listener.consideredFor, 0, .22) *
          (1 - THREE.MathUtils.smoothstep(listener.consideredFor, .6, 1.3 + gesture.delay));
        const direction = model.worldToLocal(hand.gripFrame.getWorldPosition(listener.handPoint))
          .sub(model.worldToLocal(eyes.getWorldPosition(listener.eyePoint)));
        handYaw = THREE.MathUtils.clamp(Math.atan2(direction.x, direction.z), -.4, .4);
        handPitch = THREE.MathUtils.clamp(Math.atan2(-direction.y, Math.hypot(direction.x, direction.z)), 0, .3);
      }
      const downward = Math.max(peek, tracking);
      const watch = waiting ? THREE.MathUtils.clamp(attentionYaw, -.64, .64) * (.85 - .64 * downward) : 0;
      const target = alert ? THREE.MathUtils.clamp(challengerYaw!, -gesture.limit, gesture.limit) : THREE.MathUtils.lerp(watch, handYaw, study);
      listener.angle = easeAngle('angle', listener.velocity, listener.angle, target, gesture.speed * (waiting ? .9 : 1.8), dt);
      listener.lift = easeAngle('lift', listener.velocity, listener.lift, alert ? gesture.pitch : gesture.down * Math.sin(Math.PI * listener.returning) + .18 * peek + .24 * tracking * (1 - peek) + handPitch * study * (1 - downward), gesture.speed * 1.5, dt);
      listener.roll = easeAngle('roll', listener.velocity, listener.roll, alert ? Math.sign(target) * gesture.tilt : gesture.tilt * tracking, gesture.speed * 1.3, dt);
      listener.follow = THREE.MathUtils.damp(listener.follow, alert ? 1 : 0, species === 'rogue' ? 14 : 5, dt);
      listener.active = (listener.support ? listener.follow : 0) + Math.abs(listener.angle) + Math.abs(listener.lift) + Math.abs(listener.roll) > .0001;
      if (listener.active) {
        // 把座位局部旋转换算到各自的骨骼父空间，避免镜像骨架朝反方向看。
        model.getWorldQuaternion(listener.seatFrame);
        listener.rotation.setFromEuler(listener.angles.set(listener.lift, listener.angle, listener.roll));
        if (listener.support) {
          listener.supportRest.copy(listener.support.quaternion);
          if (species === 'rogue') listener.support.rotateX(-.10 * listener.follow);
          else if (species === 'raven') listener.support.rotateY(.16 * listener.angle * listener.follow);
          else listener.support.rotateX(-.09 * listener.follow);
        }
        for (const { bone, rest } of listener.joints) {
          rest.copy(bone.quaternion);
          bone.parent!.getWorldQuaternion(listener.parentFrame).invert().multiply(listener.seatFrame);
          listener.applied.copy(listener.parentFrame).multiply(listener.rotation).multiply(listener.parentFrame.invert());
          bone.quaternion.premultiply(listener.applied);
        }
      }
    }
    if (head) {
      nod.current = THREE.MathUtils.damp(nod.current, action === 'idle' ? torsoLean : 0, 9, delta);
      head.rotateX(nod.current);
    }
    // 说话和斟酌时绕腰部微倾；骨盆和腿部仍由椅面承托。
    if (torso) torso.rotation.x = THREE.MathUtils.damp(torso.rotation.x, action === 'idle' ? torsoLean + (listener?.tableLean ?? 0) : 0, 9, delta);
    if (!reaction || action !== 'idle') overlay.elapsed = 1;
    if (memoryJoint && reaction && overlay.elapsed < 1) {
      // 动作长度小于常规思考时间，暂停和倍速与角色其余动作共用同一时钟。
      overlay.elapsed = Math.min(1, overlay.elapsed + delta * SPEED / .72);
      reactionAngles(species, reaction, overlay.elapsed, overlay.angles);
      overlay.rotation.setFromEuler(overlay.angles);
      memoryJoint.quaternion.multiply(overlay.rotation);
      if (arm === undefined) arm = pose.arm = makeReactionArm(model, species, height);
      if (arm) {
        const amount = reactionArmWeight(species, reaction, overlay.elapsed);
        arm.restUpper.copy(arm.upper.quaternion);
        arm.restLower.copy(arm.lower.quaternion);
        arm.upper.quaternion.slerp(arm.goalUpper, amount);
        arm.lower.quaternion.slerp(arm.goalLower, amount);
        arm.applied = true;
      }
      // 蒙皮在首次进桌后才应用坐姿；此时采样当前手的位置并缓存挂点。
      if (spark.current && fingertip.anchor === undefined) fingertip.anchor = mageFingertip(model);
      if (spark.current && fingertip.anchor) {
        const amount = reactionArmWeight(species, reaction, overlay.elapsed);
        // 可见指尖是蒙皮末端，光从指腹前方亮起，手部仍正常遮挡火光。
        const dot = spark.current;
        fingertip.anchor.getWorldPosition(dot.position);
        dot.parent!.worldToLocal(dot.position);
        dot.position.y += .046;
        dot.position.z += .045;
        dot.scale.setScalar(.19 * amount);
        dot.visible = amount > .12;
      }
    }
  }, -1);
  useLayoutEffect(() => {
    const clip = THREE.AnimationClip.findByName(clips, action)
      ?? THREE.AnimationClip.findByName(clips, 'idle');
    if (!clip) return;
    const next = mixer.clipAction(clip);
    const previous = current.current;
    const loop = action === 'idle';
    // 用混合器的对局时间延续呼吸周期；不同座位错开起点，收手后也不会齐齐从第一帧吸气。
    const rate = humanSeat && loop ? 0.7 : 1;
    next.reset();
    if (loop && clip.duration > 0) {
      next.time = THREE.MathUtils.euclideanModulo(mixer.time * rate + seatAngle / (2 * Math.PI) * clip.duration, clip.duration);
    }
    // 出牌和反应动作只播放一次，淘汰状态停在末帧。
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    // 人类角色的呼吸节奏适当放慢，事件动作仍按原速播放。
    next.setEffectiveTimeScale(rate);
    next.clampWhenFinished = !loop;
    // 保留上一动作直到淡出结束；立即 stop 会跳回绑定姿态，造成明显抽动。
    if (previous && previous !== next) {
      // 收手后给肩膀和躯干稍长的回落时间；离手前沿用原有动作节奏。
      next.play().crossFadeFrom(previous, loop ? 0.32 : 0.2, false);
    } else {
      // 首次入座直接显示完整坐姿，避免从模型绑定姿态闪到待机。
      next.play();
    }
    current.current = next;
    hand.play = playKey ? next : undefined;
    hand.key = playKey;
    if (!playKey) return;
    // 根据本角色真正的片段结束事件归位，避免猫咪等较长动作被截断。
    const finish = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== next) return;
      hand.finished = playKey;
      onPlayEnd(playKey);
    };
    mixer.addEventListener('finished', finish);
    return () => mixer.removeEventListener('finished', finish);
  }, [action, clips, mixer, playKey, humanSeat, hand, onPlayEnd, seatAngle]);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(model); }, [mixer, model]);
  return <>
    <primitive object={model} />
    {species === 'mage' && <sprite ref={spark} name="MemorySpark" visible={false}>
      <spriteMaterial map={glowTexture()} color="#ffba50" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </sprite>}
  </>;
}

export function Actor({
  character,
  hand,
  position,
  rotationY,
  playerYaw,
  challengerYaw,
  alive = true,
  isTurn = false,
  mood = 'idle',
  variant = 'table',
  shooting = false,
  shotDied = false,
  speaking = false,
  gaze = 0,
  thinking = false,
  reaction = null,
  tense = false,
  pressure = 0,
  playSignal,
  observedPlay,
  challenge = false,
}: {
  character: Character;
  hand: PlayingHand;
  position: [number, number, number];
  rotationY: number;
  /** 从本座位正前方看向玩家眼位所需的水平转角。 */
  playerYaw: number;
  /** 被质疑时相对本座位的质疑者方向。 */
  challengerYaw?: number;
  alive?: boolean;
  isTurn?: boolean;
  mood?: Mood;
  variant?: 'table' | 'preview';
  /** 正在举枪顶着自己脑袋 */
  shooting?: boolean;
  /** 这一枪有没有打中 */
  shotDied?: boolean;
  /** 正在说这句台词（高亮，让玩家知道话是谁说的） */
  speaking?: boolean;
  /** 视线方向：别人说话时头会偏过去 */
  gaze?: number;
  /** 正在斟酌出哪张牌（身体微微前倾） */
  thinking?: boolean;
  /** 上轮公开质疑产生的动作。 */
  reaction?: TableReaction | null;
  /** 公开手牌数量很少时显得紧张。 */
  tense?: boolean;
  /** 局势压力 0–1：手牌越少越紧张（1 = 只剩一张） */
  pressure?: number;
  /** 新出牌事件的稳定标识，变化时重新播放出牌动作。 */
  playSignal?: string;
  /** 其他座位的实际出牌，用于驱动旁观视线。 */
  observedPlay?: string;
  /** 本角色正在质疑。 */
  challenge?: boolean;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  const speechBody = useRef<THREE.Group>(null);
  // 引擎先更新胜负，画面需等举枪和枪声后才展示受击与淘汰。
  const [shotStage, setShotStage] = useState<'waiting' | 'impact' | 'finished'>('waiting');
  useEffect(() => {
    // 空枪结束后清除阶段，防止下一次举枪先闪现上一次受击动作；淘汰角色保留终态。
    if (!shooting) {
      if (alive) setShotStage('waiting');
      return;
    }
    setShotStage('waiting');
    const impact = setGameTimeout(() => setShotStage('impact'), 750 / SPEED);
    const finish = setGameTimeout(() => setShotStage('finished'), 1450 / SPEED);
    return () => { clearGameTimeout(impact); clearGameTimeout(finish); };
  }, [shooting, shotDied]);

  // 出牌事件即使被紧接着的质疑清除，也让手牌动画有时间完成。
  const [activePlay, setActivePlay] = useState<string | undefined>();
  useLayoutEffect(() => {
    if (shooting || !alive) setActivePlay(undefined);
    else if (playSignal) setActivePlay(playSignal);
  }, [playSignal, shooting, alive]);
  // 只结束刚刚播放的那一次动作，连续出牌时不会清掉较新的片段。
  const finishPlay = useCallback((key: string) => {
    setActivePlay(current => current === key ? undefined : current);
  }, []);
  // 枪击演出结束后仍保持淘汰姿态，直到游戏重置角色状态。
  const eliminated = !alive && (!shotDied || shotStage === 'finished');
  const effectiveMood: Mood = eliminated ? 'dead' : alive ? mood : 'idle';
  const action = eliminated ? 'eliminated'
    : shooting && shotStage === 'impact' ? (shotDied ? 'hit' : 'recover')
    : activePlay ? 'play' : challenge && !shooting ? 'challenge' : 'idle';

  // 挂点布局按身高缩放；枪本身用固定世界尺寸，不跟着人一起变巨
  const spec = CHARACTER_STANDEES[character.species];
  // 按实际侧面坐姿对齐椅座；两只高个角色的臀部不能沿用统一的前后偏移。
  const chairDepth = character.species === 'fox' ? 0.02 : character.species === 'raven' ? -0.35 : character.species === 'cat' ? -0.1 : -0.42;
  const seatedModelOffsetY = variant === 'table' && character.species === 'boar' ? -0.05 : 0;
  const anchoredSeat = variant === 'table';
  // 躯干旋转量使用弧度，在说话、思考和压力同时发生时也保持轻微前倾。
  const torsoLean = alive
    ? (speaking ? 0.035 : 0) + (thinking ? 0.05 : 0) + (tense ? 0.025 : 0) + pressure * 0.02
    : 0;
  // 野猪沿用原坐姿模型的前后偏移。
  const seatedModelOffsetZ = variant === 'table'
    ? character.species === 'boar' ? -0.24 : 0
    : 0;

  /** 出场动画：从下方升起 + 淡入，像刚坐下 */
  const introAt = useRef<number | null>(null);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + position[0];
    if (introAt.current === null) introAt.current = state.clock.elapsedTime + (position[0] * 0.35 + 0.6);

    // 说话高亮平滑进入和退出，避免台词切换时角色突然放大或位移。
    if (speechBody.current && !anchoredSeat) {
      const blend = 1 - Math.exp(-10 * Math.min(delta, 0.1));
      const targetScale = speaking ? 1.05 : 1;
      speechBody.current.scale.setScalar(THREE.MathUtils.lerp(speechBody.current.scale.x, targetScale, blend));
      speechBody.current.position.z = THREE.MathUtils.lerp(speechBody.current.position.z, speaking ? 0.08 : 0, blend);
    }

    if (ring.current) {
      const mat = ring.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = isTurn ? 0.7 + Math.sin(t * 3) * 0.5 : 0;
      mat.opacity = isTurn ? 0.9 : 0.15;
    }

    if (body.current) {
      // 压力：手牌少的人呼吸更快、身体更往前压（像在死撑）
      const press = Math.max(0, Math.min(1, pressure));
      const breatheSpeed = 1.35 + press * 0.85;
      const breatheAmp = 0.008 + press * 0.009;
      // 入场：还没到出场时刻就藏在桌面下，之后升上来（叠加到呼吸位移之上）
      const since = state.clock.elapsedTime - (introAt.current ?? 0);
      const raw = since < 0 ? 1 : Math.max(0, 1 - Math.min(1, since / 0.7));
      const rise = raw * raw;

      if (anchoredSeat) {
        // 入场后保持下身就座。待机、出牌和淘汰由独立骨架动作驱动。
        body.current.position.y = -rise * 1.3;
        return;
      }

      // 思考时身体往前压一点，像趴在桌上挑牌
      const leanTarget = (thinking ? 0.055 : 0) + (tense ? 0.035 : 0) + press * 0.03;
      body.current.position.z = THREE.MathUtils.lerp(
        body.current.position.z,
        leanTarget,
        0.06,
      );
      body.current.position.y =
        Math.sin(t * breatheSpeed) * breatheAmp - (thinking ? 0.012 : 0) - press * 0.02 - rise * 1.3;
      // 终局：赢家站起来（上浮 + 比例微增），其他人保持原样
      const standing = effectiveMood === 'win' ? 1 : 0;
      body.current.position.y += standing * 0.16;
      const targetScale = 1 + standing * 0.04;
      body.current.scale.setScalar(
        THREE.MathUtils.lerp(body.current.scale.x, targetScale, 0.04),
      );
      body.current.rotation.z = THREE.MathUtils.lerp(
        body.current.rotation.z,
        effectiveMood === 'dead' ? 0.32 : 0,
        0.05,
      );
    }


  });

  // 立绘单独等待纹理，避免一位角色的占位图片延迟整桌渲染。
  const standeeFallback = (
    <Suspense fallback={null}>
      <CharStandee species={character.species} mood={effectiveMood} alive={alive}
        seated={variant === 'table'} gaze={gaze} tense={tense} tellAmp={character.tell?.amp ?? 0.5} />
    </Suspense>
  );

  return (
    <group key={character.species} position={position} rotation={[0, rotationY, 0]}>
      {variant === 'table' && (
        <PropImage
          src={asset('assets/props/chair.png')}
          size={CHAIR_HEIGHT}
          position={[0, CHAIR_CENTER_Y, chairDepth]}
          opacity={0.92}
        />
      )}

      <group ref={body}>
        <group ref={speechBody} position={[0, seatedModelOffsetY, 0]}>
          <ModelBoundary key={character.species} fallback={standeeFallback}>
            <Suspense fallback={standeeFallback}>
              <group position={[0, 0, seatedModelOffsetZ]}>
                <AnimatedAnimal
                  species={character.species}
                  height={spec.height}
                  action={action}
                  consideringHand={isTurn && alive && !speaking && !shooting && !challenge}
                  observedPlay={observedPlay}
                  playSignal={activePlay}
                  seated={variant === 'table'}
                  seatAngle={rotationY}
                  playerYaw={playerYaw}
                  challengerYaw={challengerYaw}
                  attentionYaw={alive && !shooting && !challenge ? gaze : undefined}
                  chairDepth={chairDepth}
                  torsoLean={torsoLean}
                  reaction={alive && !shooting && !challenge ? reaction : null}
                  hand={hand}
                  onPlayEnd={finishPlay}
                />
              </group>
            </Suspense>
          </ModelBoundary>
        </group>

      </group>

      {variant === 'table' && (
        <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.33, speaking ? 0.5 : 0.41, 36]} />
          <meshStandardMaterial
            color={character.palette.accent}
            emissive={character.palette.accent}
            emissiveIntensity={speaking ? 1.6 : isTurn ? 0.7 : 0.35}
            transparent
            opacity={speaking ? 0.85 : isTurn ? 0.45 : 0.25}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
