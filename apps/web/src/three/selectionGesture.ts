import * as THREE from 'three';
import type { Character } from '../data/characters';

type Species = Character['species'];
type Point = [number, number, number];

/** 数值按站姿身高归一化，从脚底和头顶的中点量起，左右与选角镜头一致。 */
const hands: Record<Species, { rest: Point; goal: Point }> = {
  fox:   { rest: [-.20, -.07, .13], goal: [-.25, .035, .19] },
  raven: { rest: [-.23, -.10, .05], goal: [-.105, .322, .145] },
  boar:  { rest: [-.23, -.17, .04], goal: [-.068, .11, .16] },
  cat:   { rest: [-.21, -.22, .075], goal: [-.095, .255, .16] },
  mage:  { rest: [-.17, -.115, .078], goal: [-.19, .14, .17] },
  rogue: { rest: [-.15, -.057, .045], goal: [-.25, .115, .18] },
};

export const GESTURE_SECONDS = 1.5;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** 用缓入缓出衔接抬手、停留和放下，使结束姿态正好回到待机起点。 */
function pulse(t: number, start: number, peak: number, release: number, end: number) {
  return THREE.MathUtils.smoothstep(t, start, peak) * (1 - THREE.MathUtils.smoothstep(t, release, end));
}

/** 在镜头世界坐标中旋转骨骼，兼容 Mixamo 和各自朝向不同的试制骨架。 */
function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const localAxis = axis.clone().applyQuaternion(parentQ.invert());
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(localAxis, angle));
}

/** 对齐骨段的当前方向与期望方向；手腕的扭转由独立关节追加。 */
function aim(bone: THREE.Object3D, child: THREE.Object3D, towards: THREE.Vector3) {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const target = towards.clone().sub(origin).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(current, target);
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
}

/** 按肩肘长度反解位置，肘部向外张开，手爪朝预定的脸侧、帽檐或衣物接触点靠近。 */
export function reach(upper: THREE.Object3D, lower: THREE.Object3D, tip: THREE.Object3D, goal: THREE.Vector3, strength: number, elbowSide = -1, facing?: THREE.Quaternion) {
  if (!strength) return;
  const upperRest = upper.quaternion.clone(), lowerRest = lower.quaternion.clone();
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const elbow = lower.getWorldPosition(new THREE.Vector3());
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(tip.getWorldPosition(new THREE.Vector3()));
  const direction = goal.clone().sub(shoulder).normalize();
  const distance = THREE.MathUtils.clamp(shoulder.distanceTo(goal), Math.abs(a - b) + .0001, a + b - .0001);
  const along = (distance * distance + a * a - b * b) / (2 * distance);
  const pole = new THREE.Vector3(elbowSide * .85, -.75, .5);
  if (facing) pole.applyQuaternion(facing);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const bend = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
  aim(upper, lower, bend);
  aim(lower, tip, shoulder.clone().addScaledVector(direction, distance));
  upper.quaternion.slerp(upperRest, 1 - strength);
  lower.quaternion.slerp(lowerRest, 1 - strength);
}

/** 在独立克隆上烘焙选角片段；牌桌动作、共享缓存及原模型的节点变换均保持独立。 */
export function selectionClips(model: THREE.Object3D, species: Species, bounds: THREE.Box3) {
  const fox = species === 'fox';
  const human = species === 'mage' || species === 'rogue';
  const bone = (name: string) => model.getObjectByName(name)!;
  const upper = bone(fox ? 'mixamorigRightArm' : human ? 'arm_R' : 'upper_arm_R');
  const lower = bone(fox ? 'mixamorigRightForeArm' : 'forearm_R');
  const head = bone(fox ? 'mixamorigHead' : 'head');
  const spine = bone(fox ? 'mixamorigSpine2' : human ? 'root' : 'spine');
  const wrist = fox ? bone('mixamorigRightHand') : null;
  const leg = species === 'rogue' ? bone('leg_L') : null;
  const tail = fox ? model.getObjectByName('tail_independent_trial') : undefined;
  const joints = [spine, head, upper, lower, ...(wrist ? [wrist] : []), ...(leg ? [leg] : []), ...(tail ? [tail] : [])];
  const rest = joints.map(n => n.quaternion.clone());
  const center = bounds.getCenter(new THREE.Vector3());
  const height = bounds.max.y - bounds.min.y;
  /** 将归一化的手掌位置换成预览空间的世界坐标。 */
  const point = (v: Point) => new THREE.Vector3(...v).multiplyScalar(height).add(center);
  const tip = new THREE.Object3D();
  lower.add(tip);
  tip.position.copy(lower.worldToLocal(point(hands[species].rest)));
  const times: number[] = [], samples = joints.map(() => [] as number[]);
  // 仅在模型进入预览时求解，再由 Three 原生轨道插值，逐帧无需重新解算 IK。
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    joints.forEach((joint, j) => joint.quaternion.copy(rest[j]!));
    const goal = point(hands[species].goal);
    let weight = 0;
    if (species === 'fox') {
      // 狡狐偏头避开对视，再摊爪装无辜；尾巴在停顿时抢先甩回去。
      const glance = pulse(t, 0, .18, .26, .53);
      weight = pulse(t, .27, .48, .65, .95);
      rotateWorld(spine, Y, -.22 * glance);
      rotateWorld(head, Y, -.42 * glance + .22 * weight);
      rotateWorld(head, Z, .095 * weight);
      if (tail) rotateWorld(tail, Y, .47 * glance - .34 * pulse(t, .28, .47, .50, .81));
    } else if (species === 'raven') {
      // 鸦先生先扶帽檐，再缓缓欠身，起身后才放开帽檐。
      weight = pulse(t, .02, .27, .76, .99);
      const bow = pulse(t, .23, .48, .58, .82);
      rotateWorld(spine, X, .21 * bow);
      rotateWorld(head, X, .12 * bow);
      goal.y -= height * .027 * bow;
      goal.z += height * .046 * bow;
    } else if (species === 'boar') {
      // 野猪朝自己胸口砸两拳，第二拳更重；拳头在两次接触之间明确弹开。
      weight = pulse(t, .01, .22, .78, 1);
      const knocks = .76 * pulse(t, .23, .34, .365, .48) + pulse(t, .50, .61, .64, .80);
      goal.z += height * .10 * (1 - knocks);
      goal.x -= height * .071 * (1 - knocks);
      rotateWorld(spine, X, -.11 * knocks);
      rotateWorld(head, X, .16 * knocks);
    } else if (species === 'cat') {
      // 米拉缩起肩膀用爪子揪住兜帽，停一拍才从兜帽边探头偷看。
      weight = pulse(t, .025, .25, .70, .96);
      const peek = pulse(t, .31, .48, .65, .90);
      rotateWorld(spine, X, .13 * weight);
      rotateWorld(spine, Z, -.13 * peek);
      rotateWorld(head, X, .13 * weight - .22 * peek);
      rotateWorld(head, Z, -.24 * peek);
      rotateWorld(head, Y, .29 * peek);
      goal.y += height * .026 * peek;
    } else if (species === 'mage') {
      // 奥登单手画完法印，见到火花才向后仰头；肩部保持稳定，让圆弧看得清楚。
      weight = pulse(t, .015, .24, .81, 1);
      const theta = 2 * Math.PI * THREE.MathUtils.smoothstep(t, .24, .69);
      goal.x += .082 * height * Math.cos(theta);
      goal.y += .075 * height * Math.sin(theta);
      rotateWorld(head, X, .12 * weight - .34 * pulse(t, .65, .76, .80, .97));
    } else if (leg) {
      // 希拉先侧身把手藏在袖口，再向外侧弹出纸牌，亮牌小停后原路收袖。
      const conceal = pulse(t, .015, .21, .29, .43);
      const flash = pulse(t, .29, .45, .66, .82);
      weight = pulse(t, .025, .23, .75, .99);
      goal.x += height * .19 * (1 - flash);
      goal.y -= height * .08 * (1 - flash);
      rotateWorld(spine, Y, -.32 * conceal + .23 * flash);
      rotateWorld(head, Y, .25 * conceal - .14 * flash);
      rotateWorld(leg, Z, .072 * conceal);
    }
    reach(upper, lower, tip, goal, weight);
    if (wrist) rotateWorld(wrist, Z, -.90 * weight);
    times.push(t * GESTURE_SECONDS);
    joints.forEach((joint, j) => samples[j]!.push(...joint.quaternion.toArray()));
  }
  const gesture = new THREE.AnimationClip('selection', GESTURE_SECONDS, joints.map((joint, i) =>
    new THREE.QuaternionKeyframeTrack(joint.name + '.quaternion', times, samples[i]!)));
  joints.forEach((joint, i) => joint.quaternion.copy(rest[i]!));
  // 小幅呼吸替代牌桌坐姿待机；狐狸和乌鸦的网格内含出牌道具，选角时不播放出牌轨道。
  const idleQ = spine.quaternion.clone();
  rotateWorld(spine, X, .017);
  const idle = new THREE.AnimationClip('standingBreath', 3, [
    new THREE.QuaternionKeyframeTrack(spine.name + '.quaternion', [0, 1.5, 3], [...idleQ.toArray(), ...spine.quaternion.toArray(), ...idleQ.toArray()]),
  ]);
  spine.quaternion.copy(idleQ);
  return { gesture, idle, tip };
}
