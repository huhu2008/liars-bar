import { describe, it } from 'vitest';
import { applyCommand, chooseAction, createGame } from '../src';

describe('诊断X', () => {
  it('多出来的是哪张', () => {
    let g = createGame({ names: ['甲','乙','丙','丁'], seed: 42 });
    const all = (s: typeof g) => [
      ...s.deck, ...s.discard,
      ...s.players.flatMap((p) => p.hand),
      ...(s.pendingPlay?.cards ?? []),
    ];
    for (let i = 0; i < 80; i += 1) {
      const before = all(g);
      const beforeIds = new Set(before.map(c => c.id));
      if (g.phase === 'round_end') g = applyCommand(g, { t: 'NEXT_ROUND' }).state;
      else if (g.phase === 'turn') {
        const r = applyCommand(g, chooseAction(g, g.turnSeat, { aggression: 0.5, lieBias: 0.12 }));
        if (r.error) break;
        g = r.state;
      } else break;
      const a = all(g);
      if (a.length !== before.length) {
        const extra = a.filter(c => !beforeIds.has(c.id));
        const gone = before.filter(c => !new Set(a.map(x=>x.id)).has(c.id));
        console.log(`R${g.round} ${before.length}→${a.length} +[${extra.map(c=>c.id).join(',')}] -[${gone.map(c=>c.id).join(',')}]`);
        break;
      }
    }
  });
});
