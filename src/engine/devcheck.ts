import { CARD_SPECS } from '../content/card_specs';
import { resolveGeneratedCardIdInEffects } from './effects';
import { EFFECTS } from './effects';
import { validateAll } from './effects';
import { render } from './helpers';

const missing: Array<{ card: string; effect: string }> = [];
for (const [key, spec] of Object.entries(CARD_SPECS)) {
  const arr = Array.isArray(spec.effect) ? spec.effect : (spec.effect ? [spec.effect] : []);
  for (const e of arr) {
    if (!(e in EFFECTS)) missing.push({ card: spec.name ?? key, effect: e });
  }
}

if (missing.length) {
  for (const m of missing) console.error(`[devcheck] Missing effect handler: ${m.effect} (used by ${m.card})`);
  process.exitCode = 1;
}

const KNOWN = new Set(['end turn','exhaust','retain']);
for (const [key, spec] of Object.entries(CARD_SPECS)) {
  for (const kw of (spec.keywords ?? [])) {
    if (!KNOWN.has(kw.trim().toLowerCase())) {
      console.warn(`[devcheck] Unknown keyword "${kw}" on card ${spec.name ?? key}`);
    }
  }
}

function main() {
    const issues = validateAll(CARD_SPECS as any);
    if (issues.length) {
        for (const i of issues) console.log(`[effect-check] ${i.card}: ${i.issue}`);
    } else {
        console.log('[effect-check] OK');
    }

    const cardNameMap: Record<string, string> = Object.fromEntries(
        Object.entries(CARD_SPECS as any).map(([id, spec]: any) => [id, spec.name])
    );

    for (const [id, spec] of Object.entries(CARD_SPECS as any)) {
        const txt = render(spec.text, spec.params ?? {}, { cardNameMap, stat: { damageTakenThisTurn: 12 } });
        console.log(`[render] ${spec.name}: ${txt}`);
    }
}

main();
