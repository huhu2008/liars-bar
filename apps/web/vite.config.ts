import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // 相对基路径：itch.io 把游戏挂在 html.itch.zone/html/<id>/ 子目录下，
  // 绝对根路径会让所有贴图/音效 404（审计的阻断项之一）
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@liars/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 用函数形式按模块路径分配：
        // 之前写成对象字面量时 react chunk 产物只有 1 字节 —— react 被整个
        // 并进了 TableCanvas（因为 fiber 是从那里 import 的），拆分形同虚设。
        manualChunks() { return undefined; },
      },
    },
  },
  server: {
    port: 5183,
    strictPort: true,
  },
});
