import * as THREE from 'three';

/** 给牌桌狐狸烘焙看牌和看人的头颈轨道；其余关节直接沿用原片段。 */
export function foxGazeClips(clips: THREE.AnimationClip[], playerYaw: number): THREE.AnimationClip[] {
  // 头颈共同转动，侧座只转到自然限度，左右座分别看向自己的玩家方向。
  const lookYaw = THREE.MathUtils.clamp(playerYaw, -.72, .72);
  return clips.map(clip => {
    if (clip.name !== 'play' && clip.name !== 'challenge') return clip;
    const tracks = clip.tracks.map(track => {
      const neck = track.name === 'mixamorigNeck.quaternion';
      if (!neck && track.name !== 'mixamorigHead.quaternion') return track;
      const share = neck ? .36 : .64;
      const frames = Math.ceil(clip.duration * 30);
      const times = new Float32Array(frames + 1);
      const rotations = new Float32Array(times.length * 4);
      const original = new THREE.QuaternionLinearInterpolant(track.times, track.values, 4);
      const base = new THREE.Quaternion();
      const turn = new THREE.Quaternion();
      const angles = new THREE.Euler(0, 0, 0, 'YXZ');
      for (let i = 0; i <= frames; i++) {
        const phase = i / frames;
        const time = phase * clip.duration;
        // 先低头看偏左爪的牌，离手前开始抬头；望向玩家并停留，再平滑接回原动作。
        const down = THREE.MathUtils.smoothstep(phase, 0, .21) * (1 - THREE.MathUtils.smoothstep(phase, .34, .64));
        const up = THREE.MathUtils.smoothstep(phase, .35, .68) * (1 - THREE.MathUtils.smoothstep(phase, .84, 1));
        angles.set((.37 * down - .075 * up) * share, (.31 * down + lookYaw * up) * share, 0, 'YXZ');
        times[i] = time;
        base.fromArray(original.evaluate(time));
        turn.setFromEuler(angles).multiply(base).toArray(rotations, i * 4);
      }
      return new THREE.QuaternionKeyframeTrack(track.name, times, rotations);
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
}
