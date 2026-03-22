// Centralized status system with lifecycle & hooks (MVP)
import { log } from './logger';

// status.ts
const STACK_DECAY_PER_TURN: Record<string, number> = {
  Burning: 1,
  Weak: 1,
  Exposed: 1,
  CantAct: 1,
  Empower: 0,
  Scales: 0,
};
const stepFor = (k: string) => STACK_DECAY_PER_TURN[k] ?? 1;

export function decayStatusesPerTurn(st: any) {
  // Player
  if (st?.player?.statuses) decayMap(st, 'player', st.player.statuses);

  // Each enemy entity
  for (const e of (st?.enemies ?? [])) {
    if (!e || (e.hp ?? 0) <= 0) continue;
    if (e.statuses) decayMap(st, e.id, e.statuses);
  }
}

function decayMap(st: any, targetId: string, map: Record<string, any>) {
  for (const key of Object.keys(map)) {
    const v = map[key] ?? {};
    if (typeof v !== 'object') continue;

    const before = v.stacks ?? 0;
    const step = stepFor(key);
    if (typeof v.stacks === 'number' && step > 0) {
      v.stacks = Math.max(0, before - step);
    }
    const removed = (v.stacks ?? 0) <= 0;
    const delta = Math.max(0, before - (v.stacks ?? 0));

    // skip no-ops (e.g., Empower/Scales with step 0)
    if (!removed && delta === 0) continue;

    log(st, {
      kind: 'status:decay',
      target: targetId,               // ← concrete id
      key,
      stepStacks: delta,
      resultStacks: v.stacks ?? undefined,
      removed,
    });

    if (removed) delete map[key];
    else map[key] = v;
  }
}

function decayStepFor(key: string) {
  return (STACK_DECAY_PER_TURN[key] ?? 1);
}

function findEnemyById(st: any, id: string) {
  return (st?.enemies ?? []).find((e: any) => e?.id === id);
}

function resolveStatusTarget(st: any, whoId: string) {
  if (whoId === 'player') return { kind: 'player', ref: st.player, id: 'player' };

  // Prefer a concrete enemy id if it matches
  const byId = findEnemyById(st, whoId);
  if (byId) return { kind: 'enemy-entity', ref: byId, id: byId.id };

  // Legacy alias path: use the current alias (whatever st.enemy points to)
  if (whoId === 'enemy' && st.enemy) {
    return { kind: 'enemy-entity', ref: st.enemy, id: st.enemy.id };
  }

  // Fallback: if nothing resolves, do nothing
  return null;
}

// Internal helper
type Side = 'player' | 'enemy';
const whoKey = (whoId: string): Side => (whoId === 'enemy' ? 'enemy' : 'player');

// ---- Mutations ----
export function addStatus(
  st: any,
  whoId: string,
  id: string,
  data: { stacks?: number;[k: string]: any }
) {
  const tgt = resolveStatusTarget(st, whoId);
  if (!tgt) return;

  const ref = tgt.ref;
  if (!ref.statuses) ref.statuses = {};
  const cur = ref.statuses[id] ?? {};
  const stacks = (cur.stacks ?? 0) + (data.stacks ?? 0);
  const next = { ...cur, ...data, stacks };
  delete (next as any).duration;
  ref.statuses[id] = next;

  log(st, {
    kind: 'status:apply',
    target: tgt.id,
    key: id,
    deltaStacks: data.stacks ?? 0,
    resultStacks: stacks,
  });
}

// ---- Queries for UI ----
export function listStatuses(st: any, who: Side): Array<{ id: string; stacks?: number; duration?: number }> {
  const raw = st?.[who]?.statuses ?? st?.[who]?.status ?? {};
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([id, val]: any) => ({ id, ...(typeof val === 'object' ? val : { stacks: val }) }));
}

// ---- Hooks used by combat/damage ----
export function canPlayChecker(st: any, spec: { type?: string }): { ok: boolean; reason?: string } {
  if (spec?.type === 'Attack' && st.player?.statuses?.['CantAct']?.stacks > 0) {
    return { ok: false, reason: 'Cannot act' };
  }
  return { ok: true };
}

export function getOutgoingMultiplier(state: any, side: 'player' | 'enemy'): number {
  let m = 1;
  const sts = side === 'player' ? state.player?.statuses : state.enemy?.statuses;
  const weakStacks = sts?.Weak?.stacks ?? 0;
  if (weakStacks > 0) m *= 0.75; // constant -25% while any Weak is present
  return m;
}

export function getIncomingMultiplier(state: any, side: 'player' | 'enemy'): number {
  let m = 1;
  const sts = side === 'player' ? state.player?.statuses : state.enemy?.statuses;
  const exposedStacks = sts?.Exposed?.stacks ?? 0;
  if (exposedStacks > 0) m *= 1.25; // constant +25% while any Exposed is present
  return m;
}

export function onBeforeHitReduce(st: any, dstWho: Side, currentDamage: number): { dmg: number; reduced: number } {
  const s = st?.[dstWho]?.statuses?.['Scales'];
  if (!s || (s.stacks ?? 0) <= 0) return { dmg: currentDamage, reduced: 0 };
  const reduce = Math.max(0, s.reduceIncoming ?? 0);
  const red = Math.min(Math.max(0, currentDamage), reduce);
  const dmg = Math.max(0, currentDamage - red);
  if (s.consumePerHit) {
    s.stacks = (s.stacks ?? 0) - 1;
    if (s.stacks <= 0) delete st[dstWho].statuses['Scales'];
  } else {
    st[dstWho].statuses['Scales'] = s;
  }
  return { dmg, reduced: red };
}

export function getEndTurnDamage(st: any, who: Side): number {
  const burn = st?.[who]?.statuses?.['Burning'];
  const stacks = burn?.stacks ?? 0;
  return Math.max(0, stacks); // simple 1:1 burn tick
}

// ---- Param-driven appliers ----
export function applyStatusParams(st: any, target: Side, p: any) {
  if (!p) return;
  if (typeof p.burning === 'number' && p.burning > 0) {
    addStatus(st, target, 'Burning', { stacks: p.burning, decayPerTurn: 1 });
    //console.log('[diag] statuses:',
    //  'player=', st.player?.statuses,
    //  'enemies=', (st.enemies || []).map((e: any) => ({ id: e.id, name: e.name, statuses: e.statuses }))
    //);

  }
  if (typeof p.weak === 'number' && p.weak > 0) {
    addStatus(st, target, 'Weak', { stacks: p.weak, decayPerTurn: 1 });
    //console.log('[diag] statuses:',
    //  'player=', st.player?.statuses,
    //  'enemies=', (st.enemies || []).map((e: any) => ({ id: e.id, name: e.name, statuses: e.statuses }))
    //);

  }
  if (typeof p.exposed === 'number' && p.exposed > 0) {
    addStatus(st, target, 'Exposed', { stacks: p.exposed, decayPerTurn: 1 });
    //console.log('[diag] statuses:',
    //  'player=', st.player?.statuses,
    //  'enemies=', (st.enemies || []).map((e: any) => ({ id: e.id, name: e.name, statuses: e.statuses }))
    //);

  }
  if (typeof p.cantAct === 'number' ? p.cantAct > 0 : !!p.cantAct) {
    const stacks = typeof p.cantAct === 'number' ? p.cantAct : 1;
    addStatus(st, target, 'CantAct', { stacks });
    //console.log('[diag] statuses:',
    //  'player=', st.player?.statuses,
    //  'enemies=', (st.enemies || []).map((e: any) => ({ id: e.id, name: e.name, statuses: e.statuses }))
    //);

  }
}

export function applyConditionalParams(
  st: any,
  params: any,
  form: 'Ash' | 'Ember' | null,
  defaultTarget: Side = 'enemy'
) {
  if (!params) return;
  const hasIf = !!(params.ifEmber || params.ifAsh);

  if (form === 'Ember' && params.ifEmber) {
    applyStatusParams(st, defaultTarget, params.ifEmber);
    return;
  }
  if (form === 'Ash' && params.ifAsh) {
    applyStatusParams(st, defaultTarget, params.ifAsh);
    return;
  }

  // Fallback: only apply top-level params when no conditional blocks exist
  if (!hasIf) {
    applyStatusParams(st, defaultTarget, params);
  }
}
