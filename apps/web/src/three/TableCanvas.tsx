import type { PlayerView } from '@liars/engine';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useLayoutEffect, useSyncExternalStore } from 'react';
import type { Character } from '../data/characters';
import { TableScene } from './TableScene';

import { onGameVisibility } from '../gameClock';

const compactTouchScreen = '(max-width: 767px) and (pointer: coarse)';

/** 横竖屏或主指针变化时重新选取渲染像素上限。 */
function subscribeScreen(change: () => void) {
  const query = window.matchMedia(compactTouchScreen);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** 小屏触摸设备使用较低渲染分辨率。 */
function getMaxDpr() {
  return window.matchMedia(compactTouchScreen).matches ? 1.2 : 1.8;
}

/** 服务端尚不能获知设备类型，使用桌面上限。 */
function getServerMaxDpr() {
  return 1.8;
}

/** 共享游戏暂停状态；冻结动画时间后只响应尺寸等必要的重绘。 */
function TableClock() {
  const clock = useThree((st) => st.clock);
  const invalidate = useThree((st) => st.invalidate);
  useLayoutEffect(() => onGameVisibility((paused) => {
    if (paused) {
      clock.stop();
    } else {
      // Three.js 启动时会重置累计时间，恢复原值以接续出牌或角色动作。
      const elapsed = clock.elapsedTime;
      clock.start();
      clock.elapsedTime = elapsed;
      invalidate();
    }
  }), [clock, invalidate]);

  // 正常对局持续请求下一帧；静止时由 R3F 在尺寸、像素比等发生变化后唤醒。
  useFrame(() => { if (clock.running) invalidate(); });
  return null;
}

/**
 * 3D 入口单独成文件，好让 three 整包按需加载（选角页不下载 WebGL 栈）。
 */
export default function TableCanvas({
  view,
  characters,
  selected,
  onSelect,
  resetSignal,
}: {
  view: PlayerView;
  characters: Character[];
  selected: string[];
  onSelect: (id: string) => void;
  resetSignal: number;
}) {
  const maxDpr = useSyncExternalStore(subscribeScreen, getMaxDpr, getServerMaxDpr);
  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, maxDpr]}
      camera={{ position: [0, 1.52, 3.4], fov: 80, near: 0.05, far: 60 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <TableClock />
      <Suspense fallback={null}>
        {/* 牌走确定性动画（不依赖物理仿真），所以不需要 rapier。
            之前那个 2.1MB 的依赖只用来放一张静态桌子。 */}
        <TableScene
          view={view}
          characters={characters}
          selected={selected}
          onSelect={onSelect}
          resetSignal={resetSignal}
        />
      </Suspense>
    </Canvas>
  );
}
