import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { Revolver } from './RevolverImg';
import { SPEED } from '../store';

/** 对手位演出按角色到玩家座位的方位构图，玩家转头时道具保持在同一侧。 */
export function OpponentGun({
  position,
  height,
  shooting,
  died,
  visible = true,
}: {
  /** 角色的世界坐标（脚底中点） */
  position: [number, number, number];
  /** 角色立绘高度，用来定位太阳穴 */
  height: number;
  /** 正在被罚（举枪动画开始） */
  shooting: boolean;
  /** 这一枪打死了 */
  died: boolean;
  visible?: boolean;
}) {
  const rig = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const flashLight = useRef<THREE.PointLight>(null);
  const start = useRef<number | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    start.current = shooting ? -1 : null;
    fired.current = false;
  }, [shooting]);

  useFrame((state) => {
    const g = rig.current;
    if (!g) return;

    // 用角色到摄像机的水平连线确定画面右侧；平移与局部倾角共享这一组轴。
    const headY = position[1] + height * .74;
    const facing = Math.atan2(state.camera.position.x - position[0], state.camera.position.z - position[2]);
    const rightX = Math.cos(facing);
    const rightZ = -Math.sin(facing);
    g.rotation.order = 'YXZ';
    g.rotation.y = facing;
    const side = height * 0.155;   // 离头多远：按身高比例，个子高的角色自然偏多一点

    if (start.current === null) {
      // 收起状态：压到桌子下方，看不见
      g.position.set(
        position[0] + rightX * side,
        position[1] - 0.4,
        position[2] + rightZ * side,
      );
      g.rotation.z = 0.5;
      if (flash.current) (flash.current.material as THREE.MeshBasicMaterial).opacity = 0;
      if (flashLight.current) flashLight.current.intensity = 0;
      return;
    }

    if (start.current === -1) start.current = state.clock.elapsedTime;
    // 与事件调度共用节奏倍率，让枪声和受击动画同步。
    const el = (state.clock.elapsedTime - start.current) * SPEED;
    const raise = Math.min(1, el / 0.55);
    const eased = 1 - Math.pow(1 - raise, 3);
    const recoil = el > 0.75 && el < 0.95 ? Math.sin(((el - 0.75) / 0.2) * Math.PI) : 0;
    const drop = el > 1.45 ? Math.min(1, (el - 1.45) / 0.55) : 0;

    const riseY = headY - (1 - eased) * height * 0.5 - drop * (died ? height * 0.35 : height * 0.25) + recoil * 0.05;
    g.position.set(position[0] + rightX * side, riseY, position[2] + rightZ * side);

    g.rotation.z = 0.5 * (1 - eased) + recoil * 0.22 + drop * 0.6;

    const firing = el > 0.75 && el < 0.9;
    if (el >= 0.75 && !fired.current) {
      fired.current = true;
      sfx(died ? 'gun-shot' : 'gun-empty');
    }
    if (flash.current) {
      const mat = flash.current.material as THREE.MeshBasicMaterial;
      mat.opacity = firing ? 0.95 : 0;
      flash.current.scale.setScalar(firing ? 1.0 + Math.random() * 0.25 : 0.001);
    }
    if (flashLight.current) flashLight.current.intensity = firing ? 20 : 0;
  });

  if (!visible) return null;

  return (
    <group ref={rig} name="OpponentShotRig">
      <Revolver flashRef={flash} scale={1.2} flip tilt={0.04} />
      <pointLight ref={flashLight} position={[0, 0.18, 0]} intensity={0} distance={2.6} color="#ffb347" />
    </group>
  );
}
