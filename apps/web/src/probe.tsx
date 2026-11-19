/**
 * 环境探针：验证三件事是否真的成立
 * 1) 浏览器有 WebGL / WebGL2，拿到真实 renderer 字符串
 * 2) three + React Three Fiber 能跑起来并保持帧率
 * 3) CanvasTexture 贴图可用（卡面即将用这条路径）
 * 结果写到 window.__PROBE__，供 Playwright 读取。
 */
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

interface Probe {
  webgl2: boolean;
  version: string;
  renderer: string;
  vendor: string;
  maxTexture: number;
  three: string;
  fps: number;
  frames: number;
  textureOk: boolean;
  ready: boolean;
}

declare global {
  interface Window {
    __PROBE__?: Probe;
  }
}

function detectGpu() {
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2');
  const gl = (gl2 ?? canvas.getContext('webgl')) as WebGL2RenderingContext | null;
  if (!gl) {
    return { webgl2: false, version: 'none', renderer: 'none', vendor: 'none', maxTexture: 0 };
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl2: !!gl2,
    version: String(gl.getParameter(gl.VERSION)),
    renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
  };
}

/** 用 CanvasTexture 画一张牌面，走的就是正式游戏要用的贴图路径 */
function makeCardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f8f2e6';
  ctx.fillRect(0, 0, 256, 358);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 240, 342);
  ctx.fillStyle = '#b3261e';
  ctx.font = 'bold 64px "PingFang SC", system-ui';
  ctx.fillText('A', 22, 76);
  ctx.textAlign = 'center';
  ctx.font = '140px system-ui';
  ctx.fillText('♥', 128, 250);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function Scene({ onReady }: { onReady: (fps: number, frames: number) => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  const frames = useRef(0);
  const start = useRef(performance.now());
  const texture = useMemo(() => makeCardTexture(), []);

  useFrame((_, delta) => {
    if (mesh.current) {
      mesh.current.rotation.y += delta * 0.8;
      mesh.current.rotation.x = Math.sin(performance.now() / 1400) * 0.25;
    }
    frames.current += 1;
    const elapsed = performance.now() - start.current;
    if (elapsed > 2000) {
      onReady(Math.round((frames.current / elapsed) * 1000), frames.current);
      start.current = performance.now();
      frames.current = 0;
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 6, 4]} intensity={1.6} />
      <pointLight position={[0, 3, 0]} intensity={12} color="#ffb066" />
      <mesh ref={mesh} castShadow>
        <boxGeometry args={[1.4, 0.06, 2]} />
        <meshStandardMaterial attach="material-2" map={texture} />
        <meshStandardMaterial attach="material-3" map={texture} />
        <meshStandardMaterial attach="material-0" color="#efe6d4" />
        <meshStandardMaterial attach="material-1" color="#efe6d4" />
        <meshStandardMaterial attach="material-4" color="#efe6d4" />
        <meshStandardMaterial attach="material-5" color="#efe6d4" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]} receiveShadow>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color="#1a0f07" />
      </mesh>
    </>
  );
}

function ProbeApp() {
  const [result, setResult] = useState<Probe>(() => ({
    ...detectGpu(),
    three: THREE.REVISION,
    fps: 0,
    frames: 0,
    textureOk: !!makeCardTexture(),
    ready: false,
  }));
  const samples = useRef<number[]>([]);

  useEffect(() => {
    window.__PROBE__ = { ...result, textureOk: !!makeCardTexture() };
  }, []);

  return (
    <div style={{ height: '100vh' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2.4, 4.6], fov: 45 }}
        onCreated={({ gl }) => {
          setResult((prev) => ({ ...prev, renderer: gl.capabilities.isWebGL2 ? prev.renderer : prev.renderer }));
        }}
      >
        <color attach="background" args={['#0f0803']} />
        <Scene
          onReady={(fps) => {
            samples.current.push(fps);
            const avg = Math.round(
              samples.current.reduce((a, b) => a + b, 0) / samples.current.length,
            );
            const next = { ...result, fps: avg, frames: samples.current.length * 60, ready: samples.current.length >= 2 };
            window.__PROBE__ = next;
            setResult(next);
          }}
        />
      </Canvas>
      <div
        style={{
          position: 'fixed',
          left: 16,
          top: 16,
          color: '#e0b062',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 1.6,
          pointerEvents: 'none',
        }}
      >
        <div>renderer: {result.renderer}</div>
        <div>webgl2: {String(result.webgl2)} · three r{result.three}</div>
        <div>fps: {result.fps || '测量中…'}</div>
        <div>canvasTexture: {result.textureOk ? 'ok' : 'fail'}</div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(<ProbeApp />);
