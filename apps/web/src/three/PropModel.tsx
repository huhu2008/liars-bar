import { useGameGLTF } from './useGameGLTF';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { asset } from '../data/assetPath';

/** 模型加载失败时保留原图片，避免单一道具影响整张场景。 */
export class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  /** 捕获模型加载异常并切换到后备图片。 */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /** 正常显示模型，失败时显示原有图片。 */
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** 按包围盒等比例缩放，保持道具的中心和调用方位置一致。 */
function LoadedPropModel({ src, size, dimension = 'height', anchor = 'center' }: { src: string; size: number; dimension?: 'height' | 'width'; anchor?: 'center' | 'top' | 'tabletop' }) {
  const gltf = useGameGLTF(asset(`models/props/${src}`));
  const model = useMemo(() => {
    const copy = gltf.scene.clone(true);
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy);
    const bounds = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = dimension === 'width' ? Math.max(bounds.x, bounds.z) : bounds.y;
    const factor = span > 0 ? size / span : 1;
    // 包边最高点高于绒布；在牌桌中央垂直取交点，让牌和桌面道具贴着同一张绒布。
    let anchorY = anchor === 'center' ? center.y : box.max.y;
    if (anchor === 'tabletop') {
      const above = new THREE.Vector3(center.x, box.max.y + 1, center.z);
      const ray = new THREE.Raycaster(above, new THREE.Vector3(0, -1, 0));
      anchorY = ray.intersectObject(copy, true)[0]?.point.y ?? box.max.y;
    }
    copy.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(copy);
    wrapper.scale.setScalar(factor);
    wrapper.position.y = (center.y - anchorY) * factor;
    return wrapper;
  }, [gltf.scene, size, dimension, anchor]);
  return <primitive object={model} />;
}

/** 异步加载三维道具；加载中或失败时沿用原有图片。 */
export function PropModel({ src, size, dimension, anchor, fallback }: { src: string; size: number; dimension?: 'height' | 'width'; anchor?: 'center' | 'top' | 'tabletop'; fallback: ReactNode }) {
  return (
    <ModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LoadedPropModel src={src} size={size} dimension={dimension} anchor={anchor} />
      </Suspense>
    </ModelErrorBoundary>
  );
}
