// src/engine/specFlags.ts
export type CardFlags = {
  endTurnAfterPlay?: boolean;
  exhaustOnUse?: boolean;
  retain?: boolean;
};

const CANON = new Map<string, keyof CardFlags>([
  ['end turn', 'endTurnAfterPlay'],
  ['exhaust',  'exhaustOnUse'],
  ['retain',   'retain'],
]);

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

export function applyKeywordFlags(spec: any): any {
  const kws: string[] = Array.isArray(spec.keywords) ? spec.keywords : [];

  // primary: keywords[]
  const has = new Set(kws.map(norm));

  // optional legacy fallbacks (safe to keep; remove if you don’t need)
  const tags: string[] = spec.tags ?? [];
  if (tags.includes('EndTurn')) has.add('end turn');
  if (tags.includes('Exhaust')) has.add('exhaust');
  if (tags.includes('Retain'))  has.add('retain');

  // (optional) parse text as a last resort in dev tools only
  // const text = String(spec.text ?? '');
  // if (/\bend turn\b/i.test(text)) has.add('end turn');

  const nextFlags: CardFlags = { ...(spec.flags ?? {}) };
  for (const k of has) {
    const flag = CANON.get(k);
    if (flag) nextFlags[flag] = true;
  }

  spec.flags = nextFlags;
  return spec;
}

export function normalizeSpecs(SPECS: Record<string, any>) {
  for (const key of Object.keys(SPECS)) applyKeywordFlags(SPECS[key]);
  return SPECS;
}
