import { useGLTF } from '@react-three/drei';
import { asset } from '../data/assetPath';

/** 所有角色和道具共用随游戏部署的 Draco 解码器，支持子目录和离线加载。 */
export function useGameGLTF(url: string) {
  return useGLTF(url, asset('draco/'));
}
