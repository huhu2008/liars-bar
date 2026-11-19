import { ModalDialog } from './ModalDialog';
import { useState } from 'react';

const VERSION = '0.1.0';

/**
 * 关于面板：版本号 + 素材来源 + 技术栈。
 * 发售时需要这个入口（版本可追溯、素材可署名）。
 */
export function AboutPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center rounded-lg border border-amber-900/40 bg-black/35 px-3 text-[12px] text-amber-200/60 backdrop-blur-sm transition-all hover:border-brass-500/50 hover:bg-black/55 hover:text-amber-100/85"
        aria-label="关于本作"
      >
        关于
      </button>

      {open && (
        <ModalDialog label="关于骗子酒馆" className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClose={() => setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-xl border border-brass-500/25 bg-[#140b07] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 font-display text-lg text-brass-400">骗子酒馆</div>
            <div className="mb-4 text-[11px] text-amber-200/35">
              LIAR&apos;S BAR · 版本 {VERSION}
            </div>

            <dl className="space-y-2.5 text-[11px] leading-relaxed">
              <div>
                <dt className="text-amber-200/40">玩法</dt>
                <dd className="text-amber-100/70">
                  四人牌局，一轮一个点数。出牌、撒谎、抓人，抓错就转一次左轮。
                </dd>
              </div>
              <div>
                <dt className="text-amber-200/40">技术</dt>
                <dd className="text-amber-100/60">
                  React 19 · three.js · TypeScript · 规则引擎为纯函数
                </dd>
              </div>
              <div>
                <dt className="text-amber-200/40">角色立绘</dt>
                <dd className="text-amber-100/60">
                  含 AI 生成图像（Codex），已做透明化处理
                </dd>
              </div>
              <div>
                <dt className="text-amber-200/40">语音</dt>
                <dd className="text-amber-100/60">
                  由通义千问 TTS 合成，共 318 条
                </dd>
              </div>
              <div>
                <dt className="text-amber-200/40">音效</dt>
                <dd className="text-amber-100/60">
                  程序化合成 + Web Audio 混响
                </dd>
              </div>
              <div>
                <dt className="text-amber-200/40">3D 模型</dt>
                <dd className="text-amber-100/60">
                  Poly Pizza — Animated Wizard (CC-BY)、其余 CC0
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-lg border border-brass-500/40 bg-brass-500/10 px-4 py-2 text-[12px] text-brass-300 transition-colors hover:bg-brass-500/20"
            >
              关闭
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
