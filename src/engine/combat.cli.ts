// ---- CLI renderer (self-contained) ----
import { onEvent, setRenderEnabled } from '../engine/logger';
import type { LogEvent } from '../engine/logger';

type RenderOptions = { trace?: boolean; minimalSnaps?: boolean };

function startCliRenderer(opts: RenderOptions = {}) {
  // Ensure legacy string printing from logger.ts is OFF; this renderer handles output.
  setRenderEnabled(false);
  return onEvent((e) => renderEvent(e, opts));
}

function renderEvent(e: LogEvent, { trace = false, minimalSnaps = true }: RenderOptions) {
  switch (e.kind) {
    case 'turn:start':
      console.log(`— Turn ${e.turn}: Player —`); return;
    case 'turn:end':
      console.log(`— End of Turn ${e.turn} —`); return;

    case 'intent:set': {
      const i = (e as any).intent;
      console.log(`[intent] ${label((e as any).enemyId)} → ${prettyIntent(i)}`); return;
    }

    case 'card:play': {
      const cost = Math.max(0, e.energyBefore - e.energyAfter);
      const card = (e as any).cardName ?? e.cardId;
      console.log(`Play: ${card} (cost ${cost}, E ${e.energyBefore}→${e.energyAfter})`);
      if (e.aoe) console.log(`  • Target: ALL`);
      else if (e.target) console.log(`  • Target: ${label(e.target)}`);
      return;
    }

    case 'damage': {
      const d = e as any;
      const head = d.source === 'status:Burning' ? `End: ${label(d.target)} takes` : `  → ${label(d.target)}:`;
      const math = trace ? ` [base ${d.base} -blk ${d.blocked} ⇒ ${d.modified}]` : '';
      console.log(`${head} ${d.modified} damage (HP ${d.hpBefore}→${d.hpAfter})${math}`);
      return;
    }

    case 'block:gain':
      console.log(`  • ${label(e.target)} gains ${e.amount} Block (now ${e.blockAfter})`); return;

    case 'status:apply': {
      const s = e as any;
      const before = (s.resultStacks ?? 0) - (s.deltaStacks ?? 0);
      const key = s.key === 'Empower' ? 'Emp' : s.key;
      console.log(`  • ${label(s.target)} ${key}: ${before}→${s.resultStacks ?? 0}`); return;
    }

    case 'status:decay': {
      const s = e as any;
      const before = (s.resultStacks ?? 0) + (s.stepStacks ?? 0);
      const key = s.key === 'Empower' ? 'Emp' : s.key;
      console.log(`  • ${label(s.target)} ${key}: ${before}→${s.resultStacks ?? 0}${s.removed ? ' (removed)' : ''}`); return;
    }

    case 'energy:change': return;         // redundant with card:play
    case 'pile:move':     return;         // keep quiet unless debugging
    case 'status:snapshot':
      if (!minimalSnaps) console.log(`[snap] ${(e as any).where}`); return;

    case 'diag':
      console.log(`[diag] ${(e as any).msg}`); 
        return;
  }
}

function label(id: string) { return id === 'player' ? 'Player' : id; }
function prettyIntent(i: any) {
  if (!i) return '…';
  if (i.kind === 'attack') return `Attack ${i.value ?? 0}`;
  if (i.kind === 'defend') return `Defend ${i.value ?? 0}`;
  if (i.kind === 'debuff') return `Debuff ${i.status?.key ?? ''} +${i.status?.stacks ?? 0}`;
  return String(i.kind ?? '…');
}
// ---- end CLI renderer ----
