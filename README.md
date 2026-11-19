# 骗子酒馆 · Liar's Bar

一款「隐藏信息 + 心理博弈」的 3D 多人牌桌游戏。浏览器打开即玩，也可打包成 macOS / Android 应用。

**核心循环**：每人 5 张牌，轮流声明自己出了几张某个点数，可以撒谎。被质疑就翻牌验证，出假牌的一方要拿起左轮对自己开一枪——空枪继续玩，实弹出局。

<p>
  <a href="https://huhu2008.github.io/liars-bar/"><strong>▶ 在线游玩</strong></a>
  ·
  <a href="#快速开始">本地运行</a>
  ·
  <a href="#打包安装">下载安装包</a>
</p>

## 特性

- **真 3D 牌桌**：第一人称坐席，拖拽转头看旁边的客人，牌是真刚体（Rapier 物理），出牌会飞出去、落地、压成一堆
- **六个角色**：狡狐、鸦先生、屠夫、小猫、老法师、浪人，各有独立的性格参数、看牌破绽和 15 个场景的台词
- **494 条语音**：千问 TTS 生成，按场景区分语气——质疑时短促、记仇时阴沉、决斗时放慢，同一角色语速跨度 2~5 倍
- **原声集**：游戏内可直接试听全部音效和台词，像一张 OST
- **三端可跑**：Web（浏览器）/ macOS（Electron）/ Android（Capacitor）
- **纯 TS 规则引擎**：与渲染完全解耦，96 个单测覆盖整场对局、双向结算、弹仓递增、视图不泄漏

## 快速开始

需要 Node.js ≥ 20 和 pnpm。

```bash
git clone https://github.com/huhu2008/liars-bar.git
cd liars-bar
pnpm install
pnpm dev
```

打开 http://localhost:5183

## 玩法

1. 选一个角色入座，桌上共 4 人
2. 每轮开局指定一个点数，之后每人轮流打出 1~3 张牌，声明「我出的是这个点数」
3. 可以撒谎，但下家可以点「质疑」
4. 被质疑后翻牌验证：
   - 出牌者说的是真话 → 质疑者受罚
   - 出牌者撒谎 → 出牌者受罚
5. 受罚者拿起左轮对自己开一枪，弹仓 6 格逐格递增：空枪继续，实弹出局
6. 最后活着的人获胜

**牌组**：Q × 6 + K × 6 + A × 6 + 赖子 × 2 = 20 张，4 人各 5 张。赖子可以当任意点数。

**每回合 30 秒**，超时自动托管。

## 技术栈

| 层 | 技术 |
|---|---|
| 规则引擎 | 纯 TypeScript，无运行时依赖 |
| 前端 | React 19 + Vite 6 |
| 3D 渲染 | three.js r187 + @react-three/fiber 9 + drei 10 |
| 物理 | @dimforge/rapier |
| 状态管理 | zustand |
| 桌面打包 | Electron + electron-builder |
| 移动打包 | Capacitor 7 |
| 测试 | Vitest + Playwright |

## 项目结构

```
liars-bar/
├─ packages/engine/          纯 TS 规则引擎
│  ├─ src/reducer.ts         状态机：createGame / applyCommand
│  ├─ src/view.ts            project()：裁剪对手手牌，只留张数
│  └─ src/*.test.ts          96 个单测
├─ apps/web/                 前端
│  ├─ src/three/             3D 场景：牌桌、角色、物理、枪
│  ├─ src/audio/             统一音频模块（音效 + 语音 + 原声集）
│  ├─ src/components/        UI：选角页、设置、原声集、结算面板
│  ├─ src/store.ts           zustand store + 事件链
│  └─ public/                静态资源（模型 / 语音 / 贴图）
├─ desktop/                  Electron 主进程
├─ android/                  Capacitor 生成的 Android 工程
└─ scripts/                  构建、排查、冒烟测试脚本
```

**设计要点**：客户端只发意图，视图一律经过 `project()` 裁剪。接联机时把 `applyCommand` 搬到 Node 端即可，前端不用改。

## 开发命令

```bash
pnpm dev                 # 开发服务器
pnpm build               # 生产构建
pnpm test                # 引擎单测
pnpm typecheck           # 类型检查
pnpm desktop             # Electron 窗口运行
```

排查脚本（都带浏览器自动化，输出 PASS/FAIL）：

```bash
node scripts/audit-all.mjs      # 全面排查：资源、六角色、完整对局、存档恢复
node scripts/audit-flow.mjs     # 流程排查：人数、设置、重开、换角色
python3 scripts/audit-scenes.py # 语音场景区分度检查
node scripts/shot-electron.mjs  # 打包后的 app 截图验证
```

## 打包安装

```bash
# macOS（输出到 release/）
pnpm dist:mac

# Windows / Linux
pnpm dist:win
pnpm dist:linux

# Android APK
npx cap sync android
cd android && ./gradlew assembleRelease
```

macOS 首次打开会被 Gatekeeper 拦（无 Apple 开发者证书），需在「系统设置 → 隐私与安全性」点「仍要打开」。

## 音频说明

语音由 [阿里云百炼 Qwen-Audio-TTS](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list) 生成，脚本在 `scripts/gen-vo-qwen.py`。

```bash
python3 scripts/gen-vo-qwen.py --only mage --force   # 重录某个角色
```

需要 `.env.local` 里有 `DASHSCOPE_API_KEY`。

音频分三层：
- **音效**：11 个（发牌、翻牌、开枪、空枪、计时滴答…）
- **环境音**：酒馆底噪，说话时自动压低
- **角色语音**：494 条，按场景分包

场景语气表在 `scripts/gen-vo-qwen.py` 的 `SCENE_MOOD`，改完重录即可。

## 已知限制

- **没有联机**：目前是本地对局 + AI 对手。`applyCommand` 已就绪，差传输层
- **触屏未真机验证**：桌面用鼠标调过，手机上的点击区域可能偏小
- **首次加载较慢**：模型和语音约 98MB，建议用宽带

## 许可证

MIT
