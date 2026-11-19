import * as THREE from 'three';
import { reach } from './selectionGesture';
import type { PlayerView } from '@liars/engine';
import type { ModelKey } from './models';

export interface TableReaction {
  revealSeq: number;
  caught: boolean;
  yaw: number;
}

/** 只从上轮的公开事件还原谁质疑了谁。下轮当事人第一次行动后便不再触发。 */
export function readTableReaction(view: Pick<PlayerView, 'phase' | 'round' | 'turnSeat' | 'log' | 'seats'>): TableReaction | null {
  if (view.phase !== 'turn' || view.round < 2) return null;
  const seat = view.turnSeat;
  let punished: number | undefined;
  let revealSeq: number | undefined;
  for (let i = view.log.length - 1; i >= 0; i--) {
    const event = view.log[i]!;
    if (event.round === view.round) {
      if (event.seat === seat && (event.kind === 'play' || event.kind === 'challenge' || event.kind === 'pass')) return null;
      continue;
    }
    if (event.round !== view.round - 1) break;
    if (event.kind === 'shot') punished = event.seat;
    if (event.kind === 'reveal') {
      if (event.seat !== seat) return null;
      revealSeq = event.seq;
    }
    if (event.kind === 'challenge' && event.seat !== undefined && revealSeq !== undefined && punished !== undefined) {
      // 侧邻转向质疑者，正对面的座位自然看向桌心。
      const angle = (event.seat - seat) * 2 * Math.PI / view.seats.length;
      const yaw = Math.atan2(-Math.sin(angle), 1 - Math.cos(angle));
      return { revealSeq, caught: punished === seat, yaw };
    }
  }
  return null;
}

/** 平滑起落的短动作，起止帧回到原有骨骼姿势。 */
function pulse(t: number, from: number, to: number): number {
  if (t <= from || t >= to) return 0;
  return Math.sin(Math.PI * (t - from) / (to - from)) ** 2;
}

/** 将记忆反应转换成腰部或头部的微动作，绝不读取当前手牌。 */
export function reactionAngles(species: ModelKey, cue: TableReaction, t: number, out: { x: number; y: number; z: number }) {
  const look = pulse(t, 0, .80);
  const accent = cue.caught ? .8 : 1.15;
  out.x = 0; out.y = 0; out.z = 0;
  switch (species) {
    case 'fox':
      // 狡狐先瞥质疑者，看清后赶紧缩回下巴。
      out.y = cue.yaw * .60 * look;
      out.x = .14 * pulse(t, .24, .90) * accent;
      break;
    case 'raven':
      // 乌鸦慢慢压低帽檐，短暂停在桌心。
      out.x = .24 * pulse(t, .04, .98) * accent;
      out.y = cue.yaw * .16 * look;
      break;
    case 'boar':
      // 屠夫被冤后更用力挺胸，两次短促顿挫落在不同拍上。
      out.x = (-.13 * pulse(t, .02, .44) - .21 * pulse(t, .44, .96)) * accent;
      break;
    case 'cat':
      // 小猫歪头躲开，然后从兜帽边偷看。
      out.z = .20 * pulse(t, 0, .61) * accent;
      out.y = cue.yaw * .43 * pulse(t, .25, .97);
      break;
    case 'mage':
      // 法师先侧头端详，再轻轻摇头。
      out.z = -.12 * pulse(t, .01, .69);
      out.y = .18 * Math.sin(t * Math.PI * 3) * pulse(t, .14, .98) * accent;
      break;
    case 'rogue':
      // 浪人只给一个短促侧眼，随后微抬下巴。
      out.y = cue.yaw * .55 * pulse(t, 0, .43);
      out.x = -.15 * pulse(t, .27, .86) * accent;
      break;
  }
}

/** 从坐姿的实际肩、肘和指尖烘焙一个姿势，渲染时只混合两个局部四元数。 */
export function makeReactionArm(model: THREE.Object3D, species: ModelKey, height: number) {
  if (species === 'fox' || species === 'mage') return null;
  // 动物用空爪扶帽或捶胸；浪人用右腕做收袖动作。
  const human = species === 'rogue';
  const upper = model.getObjectByName(human ? 'arm_R' : 'upper_arm_L');
  const lower = model.getObjectByName(human ? 'tableForearm_R' : 'forearm_L');
  const head = model.getObjectByName('head');
  if (!upper || !lower || !head) return null;
  const tip = new THREE.Object3D();
  const palm = model.getObjectByName('CardRelease');
  if (!palm) return null;
  // 两侧手臂镜像对应；复用右掌标定长度确定左掌在前臂上的位置。
  tip.position.copy(palm.position);
  if (!human) tip.position.x *= -1;
  lower.add(tip);
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const goal = head.getWorldPosition(new THREE.Vector3());
  const tipRest = tip.getWorldPosition(new THREE.Vector3());
  const facing = model.getWorldQuaternion(new THREE.Quaternion());
  const offset = new THREE.Vector3();
  if (species === 'raven' || species === 'cat') {
    const top = new THREE.Box3().setFromObject(model, true).max.y;
    goal.y = top - height * (species === 'raven' ? .27 : .19);
    offset.set(.085, 0, .075);
  } else if (species === 'boar') {
    goal.y = shoulder.y - height * .055;
    offset.set(.04, 0, .16);
  } else {
    // 浪人将手拢回袖口；出牌片段仍从正常持牌位置开始。
    goal.copy(tipRest);
    offset.set(.085, .06, -.04);
  }
  goal.add(offset.multiplyScalar(height).applyQuaternion(facing));
  const restUpper = upper.quaternion.clone(), restLower = lower.quaternion.clone();
  reach(upper, lower, tip, goal, 1, human ? -1 : 1, facing);
  const arm = {
    upper, lower, tip, goalUpper: upper.quaternion.clone(), goalLower: lower.quaternion.clone(),
    restUpper, restLower, applied: false,
  };
  upper.quaternion.copy(restUpper); lower.quaternion.copy(restLower);
  return arm;
}

/** 双拍捶胸、扶帽停顿、拢袖快收分别使用不同的力度包络。 */
export function reactionArmWeight(species: ModelKey, cue: TableReaction, t: number) {
  if (species === 'boar') return (cue.caught ? .78 : 1) * (.72 * pulse(t, 0, .44) + pulse(t, .44, 1));
  if (species === 'rogue') return pulse(t, .06, .79);
  return THREE.MathUtils.smoothstep(t, .02, .32) * (1 - THREE.MathUtils.smoothstep(t, .61, .96));
}

/** 法师空手一侧没有独立手骨，从实际蒙皮中取最远的指尖；不移动握牌手。 */
export function mageFingertip(model: THREE.Object3D) {
  const arm = model.getObjectByName('arm_L');
  if (!arm) return null;
  const shoulder = arm.getWorldPosition(new THREE.Vector3());
  const point = new THREE.Vector3(), end = new THREE.Vector3();
  let distance = 0;
  model.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    const joint = node.skeleton.bones.indexOf(arm as THREE.Bone);
    if (joint < 0) return;
    const { position, skinIndex, skinWeight } = node.geometry.attributes;
    const step = Math.max(1, Math.floor(position.count / 5000));
    for (let i = 0; i < position.count; i += step) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (skinIndex.getComponent(i, k) === joint) weight += skinWeight.getComponent(i, k);
      if (weight < .65) continue;
      node.getVertexPosition(i, point);
      node.localToWorld(point);
      // 衣袖共享肩部权重；只选肩线以下的顶点，排除重建材质延伸到帽檐的散点。
      if (point.y >= shoulder.y) continue;
      const d = shoulder.y - point.y;
      if (d > distance) { distance = d; end.copy(point); }
    }
  });
  if (!distance) return null;
  const tip = new THREE.Object3D();
  arm.add(tip);
  tip.position.copy(arm.worldToLocal(end));
  return tip;
}
