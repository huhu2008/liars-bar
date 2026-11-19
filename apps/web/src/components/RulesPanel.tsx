import { useState } from 'react';
import { asset } from '../data/assetPath';

/**
 * 玩法说明。第一次进来的人不知道「骗子酒馆」怎么玩，
 * 之前完全没有规则入口 —— 这里做成可折叠的卡片，默认收起。
 */
export function RulesPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative z-10 mx-auto mt-3 w-full max-w-2xl px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mx-auto flex items-center gap-2 rounded-full border border-amber-800/40 bg-black/40 px-4 py-1.5 text-[11px] tracking-[0.2em] text-amber-200/60 backdrop-blur-sm transition-colors hover:border-amber-600/60 hover:text-amber-100"
      >
        <img src={asset('assets/ui/ic-help.png')} alt="" className="h-3.5 w-3.5 opacity-70" />
        玩法说明
        <span className="text-[10px] opacity-60">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="velvet mt-3 rounded-xl border border-brass-500/25 p-5 text-[12px] leading-relaxed text-amber-100/80 shadow-[0_0_40px_rgba(0,0,0,0.6)]">
          <Section title="一、目标">
            桌上每人 5 张牌。轮到你时，把 1–3 张牌背面朝下推到桌上，<b>声称</b>它们都是本轮点数
            —— 你可以说真话，也可以撒谎。活到最后的人赢下整局。
          </Section>

          <Section title="二、一次回合">
            两种选择：
            <ul className="mt-1 list-disc pl-5">
              <li><b>出牌</b>：选 1–3 张，声明「这几张都是 X」。真假随意，没人能看。</li>
              <li><b>质疑</b>：不信上一个人，当场翻开他刚推出来的牌。</li>
            </ul>
          </Section>

          <Section title="三、质疑怎么结算">
            每张牌都得符合声明的点数，王牌可以当作本轮点数。
            <ul className="mt-1 list-disc pl-5">
              <li>他<b>没撒谎</b> → 质疑的人受罚（你错怪了人）</li>
              <li>他<b>撒谎了</b> → 出牌的人受罚</li>
            </ul>
            受罚的人举起左轮对自己的头扣一次扳机。弹仓共 6 格，开局装 1 发。每次空枪再加 1 发，中弹的人出局。
          </Section>

          <Section title="四、最后一手">
            打出最后一手后，下家还有一次质疑机会。下家放行，或翻牌后证实你说了真话，你就赢下本轮；撒谎被抓则失去本轮胜利。只要还有多人存活，就重新发牌。
          </Section>

          <Section title="五、一些细节">
            <ul className="mt-1 list-disc pl-5">
              <li>每个角色的性格不同：胆大的爱诈、多疑的爱抓、老实的几乎不说谎</li>
              <li>轮到你时有 30 秒，超时会自动托管（有牌在桌上就质疑，否则出牌）</li>
              <li>按住画面左右拖动可以转头看旁边的人，右下角「回正」把视野摆正</li>
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1 font-display text-[12px] tracking-[0.18em] text-brass-400">{title}</h3>
      <div className="text-amber-100/70">{children}</div>
    </section>
  );
}
