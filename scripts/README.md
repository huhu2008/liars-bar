# scripts/ — 测试与工具

都是 Playwright + 系统 Chrome 的端到端脚本，直接 `node scripts/<name>.mjs` 跑。
默认连 `http://localhost:5183`（先 `pnpm --filter @liars/web dev`）。

## 核心回归

| 脚本 | 检查什么 |
|---|---|
| `final-verify.mjs` | 完整一局到 game_end：终局面板、音效、语音条数、控制台错误 |
| `loop-verify.mjs` | 打完一局后点「再来一局」，第二局是否正常 |
| `round-test.mjs` | 发牌 / 出牌 / 回合推进的时间轴 |
| `soak.mjs` | 长时间压测：内存曲线、多局往返 |
| `anim-check.mjs` | 桌面截图（`/tmp/f1.png`、`/tmp/f2.png`） |
| `perf.mjs` | 帧耗时统计（看有没有掉帧） |

## 状态一致性（这类 bug 的高发区）

| 脚本 | 检查什么 |
|---|---|
| `state-matrix.mjs` | 三条进入路径（首次/换角色/重开）后 UI 状态是否干净 |
| `cards-visible.mjs` | 三条路径下手牌是否都渲染出来 |
| `hidden-reset.mjs` | `handHidden` 被置 true 后重开，能否原子重置 |
| `round-trigger.mjs` | `nextRound()` 是否同时 bump 收牌和发牌信号 |
| `collect-anim.mjs` | 跨轮推进时收牌动画是否稳定 |
| `deal-count.mjs` | 重开 / 换角色后发牌动画只播一次 |

## 存档与设置

| 脚本 | 检查什么 |
|---|---|
| `save-test.mjs` | 刷新后恢复存档，轮次和手牌是否一致 |
| `resume-visible.mjs` | 从 round_end 存档恢复后，手牌是否可见 |
| `save-lock.mjs` | 有存档时角色选择是否锁定、界面显示是否正确 |
| `settings-test.mjs` | 设置面板（音量、语音开关）在选角页和牌桌都能用 |
| `volume-test.mjs` | 音量改动 → 持久化 → 刷新后仍生效 |
| `keyboard-test.mjs` | 数字键选牌、Esc 取消 |

## 移动端 / 部署 / 音频

| 脚本 | 检查什么 |
|---|---|
| `mobile-check.mjs` | 四个视口（390/768/320/1280）布局无溢出 + 手牌点测 |
| `touch-drag.mjs` | 触摸拖动能否转视角 |
| `subdir-test.mjs` | 子目录部署（模拟 itch.io）零 404 |
| `audio-404.mjs` | 所有音频资源是否可加载 |
| `reverb-test.mjs` | Web Audio 混响链是否建立、AudioContext 是否 running |

## 玩法

| 脚本 | 检查什么 |
|---|---|
| `multi-count.mjs` | 2 人 / 3 人局能否打到终局 |
| `gun-all2.mjs` | 2/3/4 人局各座位被罚时枪的位置（截帧） |
| `sel.mjs` / `click.mjs` | 手牌选中、命中区是否准确 |
| `rapid.mjs` | 连点出牌不会重复提交 |
| `interact.mjs` | 语音开关、缩放、重开 |
| `contrast.mjs` | 暗色主题的 WCAG 对比度 |

## 台词触发

| 脚本 | 检查什么 |
|---|---|
| `new-lines-test.mjs` | lastCard / cornered / grudge 是否在特定时刻播报 |
| `opening-test.mjs` | 开局第一句 |
| `witness-test.mjs` | 目睹他人死亡的反应 |
| `duel-test.mjs` | 剩两人时的对峙白 |
| `trigger-test.mjs` | 构造条件强制触发情境台词 |

## 工具脚本（Python）

| 脚本 | 用途 |
|---|---|
| `gen-vo-qwen.py` | 用通义千问 TTS 批量生成语音（读 `.env.local` 的 key） |
| `vo-audit.py` | 检查语音文件与台词表是否一一对应 |
| `asset-audit.py` | 检查素材是否都被引用 |

---

## 写新脚本的约定

- 用 `chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })`
- 进游戏先 `getByRole('button', { name: /入座/ }).first().click()`，再 `waitForFunction(() => !!window.__STORE__)`
- 有存档时「入座」会变成「放弃这局」，测试前先 `localStorage.removeItem('liars-bar:save')`
- 探针：`__STORE__`（zustand）、`__SND__`（音效）、`__VOICE__`（语音）、`__HAND__`（手牌坐标）、`__AMB__`（底噪增益）、`__VOICE_VOL__`（语音主音量）
