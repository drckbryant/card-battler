import type { CardSpec, CardSpecs, EffectsRegistry, EffectKey, CardParams } from './types';
import { CARD_SPECS } from '../content/card_specs';
import { getForm, changeForm } from './forms';
import { addStatus, getOutgoingMultiplier, getIncomingMultiplier, onBeforeHitReduce } from './status';

// Convert ctx.targets/ctx.target into a concrete list of ids
function targetsOf(ctx: any): string[] {
    if (Array.isArray(ctx.targets) && ctx.targets.length) return ctx.targets;
    if (ctx.target) return [ctx.target];
    // Back-compat: default to player if nothing was provided
    return ['player'];
}

function allAliveEnemyIds(st: any): string[] {
    return (st.enemies ?? [])
        .filter((e: any) => e && (e.hp ?? 0) > 0)
        .map((e: any) => e.id);
}

// Normalize ctx.targets / ctx.target to a unique, concrete id list.
// If the card is AOE, ignore ctx.targets and take all alive enemies.
function targetsUniqueIds(ctx: any): string[] {
    const st = ctx.state;
    const p: any = ctx.params || {};
    // If effect/card is AOE, target ALL alive enemies by concrete id
    if (p.aoe) return allAliveEnemyIds(st);

    const out: string[] = [];
    const pushId = (tid: string | undefined) => {
        if (!tid) return;
        if (tid === 'player') { out.push('player'); return; }
        if (tid === 'enemy') { if (st.enemy?.id) out.push(st.enemy.id); return; }
        // assume concrete enemy id
        const e = (st.enemies ?? []).find((x: any) => x?.id === tid);
        if (e) out.push(e.id);
    };

    if (Array.isArray(ctx.targets) && ctx.targets.length) {
        for (const t of ctx.targets) pushId(t);
    } else {
        pushId(ctx.target);
    }

    // de-duplicate
    return Array.from(new Set(out));
}

// Per-card-play idempotence: prevents re-applying the SAME status to the SAME
// target more than once during this card’s resolution (even if resolver runs twice).
function applyOnceInThisPlay(ctx: any, statusKey: string, targetId: string): boolean {
    const mark = `status:${statusKey}@${targetId}`;
    const store: Set<string> = (ctx.__appliedOnce ||= new Set<string>());
    if (store.has(mark)) return false;
    store.add(mark);
    return true;
}


// Apply a status to each id in `targets` ('player' or enemy ids)
// Uses your existing addStatus helper and keeps logs simple/consistent.
function applyStatusToTargets(
    st: any,
    targets: string[],
    key: string,
    stacks: number
) {
    const ids: string[] = [];

    for (const tid of targets) {
        if (tid === 'player') {
            ids.push('player');
            continue;
        }

        if (tid === 'enemy') {
            // Legacy alias → current enemy focus, if set
            if (st.enemy?.id) ids.push(st.enemy.id);
            continue;
        }

        // Concrete enemy id?
        const e = (st.enemies ?? []).find((x: any) => x?.id === tid);
        if (e) ids.push(e.id);
        // (silently ignore unknown tokens like 'ally' here; expand if you use them)
    }

    // Deduplicate so 'enemy' + 'enemy-1' doesn’t double-apply
    const uniqueIds = Array.from(new Set(ids));

    for (const id of uniqueIds) {
        if (id !== 'player') {
            const e = (st.enemies ?? []).find((x: any) => x?.id === id);
            if (!e || (e.hp ?? 0) <= 0) continue; // skip invalid/downed
        }
        addStatus(st, id, key, { stacks });
    }
}

export const EFFECTS: EffectsRegistry = {
    // Declarative schemas
    gainBlock: {
        resolve(ctx: any) {
            const st = ctx.state;
            const p: any = ctx.params || {};
            const amt = Number(p.block ?? p.amount ?? 0);
            if (!amt) return;
            const tgts: string[] = Array.isArray(ctx.targets) && ctx.targets.length
                ? ctx.targets
                : (ctx.target ? [ctx.target] : ['player']); // back-compat default

            for (const tid of tgts) {
                if (tid === 'player') {
                    const before = st.player.block ?? 0;
                    st.player.block = (st.player.block ?? 0) + amt;
                    log(st, { kind: 'block:gain', target: 'player', amount: amt, blockBefore: before, blockAfter: st.player.block ?? 0 });
                } else {
                    const prev = st.enemy;
                    const ally = st.enemies?.find((e: any) => e.id === tid);
                    if (ally) ally.block = (ally.block ?? 0) + amt;
                    st.enemy = prev;
                }
            }
        }
    },

    // NEW: global Empower — Attacks deal +X damage per hit
    empower: {
        required: ['amount'],
        resolve(ctx: any) {
            const st = ctx.state;
            const p: any = ctx.params || {};
            // Accept various shapes: { amount }, { stacks }, { empower }, { plus: { amount } }
            const amtRaw = (p.amount ?? p.stacks ?? p.empower ?? p.plus?.amount ?? 0);
            const amt = Number(amtRaw);
            if (!amt) return;

            const tgts = targetsOf(ctx); // <- capital O
            applyStatusToTargets(st, tgts, 'Empower', amt);
        }
    },
    exposed: {
        resolve(ctx: any) {
            const st = ctx.state;
            const p: any = ctx.params || {};
            const stacks = Number(p.exposed ?? p.stacks ?? 1);
            if (!stacks) return;

            const ids = targetsUniqueIds(ctx);
            for (const id of ids) {
                if (id !== 'player') {
                    const e = (st.enemies ?? []).find((x: any) => x?.id === id);
                    if (!e || (e.hp ?? 0) <= 0) continue;
                }
                if (!applyOnceInThisPlay(ctx, 'Exposed', id)) continue; // ← idempotent
                addStatus(st, id, 'Exposed', { stacks });
            }
        }
    },
    burning: {
        resolve(ctx: any) {
            const st = ctx.state;
            const p: any = ctx.params || {};
            const stacks = Number(p.burning ?? p.stacks ?? 1);
            if (!stacks) return;
            const tgts = targetsOf(ctx);
            applyStatusToTargets(st, tgts, 'Burning', stacks);
        }
    },
    weak: {
        resolve(ctx: any) {
            ctx.state.log.push('[diag] resolve:weak ' + JSON.stringify(targetsUniqueIds(ctx)));
            const st = ctx.state;
            const p: any = ctx.params || {};
            const stacks = Number(p.weak ?? p.stacks ?? 1);
            if (!stacks) return;

            const ids = targetsUniqueIds(ctx);
            for (const id of ids) {
                if (id !== 'player') {
                    const e = (st.enemies ?? []).find((x: any) => x?.id === id);
                    if (!e || (e.hp ?? 0) <= 0) continue;
                }
                if (!applyOnceInThisPlay(ctx, 'Weak', id)) continue;  // ← idempotent
                addStatus(st, id, 'Weak', { stacks });
            }
        }
    },
    gainEmpower: {
        required: ['amount'],
        resolve(ctx) {
            const p: any = ctx.params || {};
            const amt = Number(p.amount ?? 0);
            if (!amt) return;
            const sts: any = ctx.state.player.statuses || (ctx.state.player.statuses = {});
            const cur = sts.Empower?.stacks ?? 0;
            const next = cur + amt;
            sts.Empower = { ...(sts.Empower || {}), stacks: next };
            ctx.state.log.push(`${amt > 0 ? 'Gained' : 'Lost'} Empower ${amt > 0 ? '+' : ''}${amt} (now ${next}).`);
        }
    },
    hitsPerTag: { required: ['tag', 'damagePer'], optional: ['aoe'] }, // resolved in combat (needs damage pipeline)
    gainEnergy: {
        required: ['energy'],
        resolve(ctx) {
            const e = Math.max(0, Number((ctx.params as any)?.energy ?? 0));
            if (e > 0) {
                const before = ctx.state.player.energy ?? 0;                        // ← capture
                ctx.state.player.energy = before + e;                               // ← mutate
                log(ctx.state, {                                                    // ← structured log
                    kind: 'energy:change',
                    who: 'player',
                    delta: e,
                    before,
                    after: ctx.state.player.energy,
                });
                ctx.state.log.push(`Gained ${e} Energy (now ${ctx.state.player.energy}).`); // keep your human line if you like
            }
        }
    },
    detonation: { required: ['damage'], optional: ['aoe', 'ifEmber', 'ifEmber.burning', 'ifEmber.aoe'] },
    ashScales: { required: ['reduceIncoming'] },
    // Add-to-hand (Ren: Cauldron → Awen: Empower)
    addCardToHand: {
        required: [], optional: ['cardId', 'CardId', 'cardID', 'CardID', 'tag', 'owner', 'name', 'pool', 'count'],
        resolve(ctx) {
            const p: any = ctx.params || {};
            const rawId = p.cardId ?? p.CardId ?? p.cardID ?? p.CardID;
            const count = Math.max(1, Number(p.count ?? 1));
            // Use resolver already present in this file
            const id = rawId ?? resolveGeneratedCardIdInEffects(ctx.specKey ?? (ctx.spec as any)?.id ?? (ctx.spec as any)?.name, 'addCardToHand', p);
            if (!id || !CARD_SPECS[id]) return;
            for (let i = 0; i < count; i++) ctx.state.hand.push(id as any);
            const name = CARD_SPECS[id]?.name ?? id;
            ctx.state.log.push(`Added ${count} × ${name} to your hand.`);
        }
    },

    // One-turn multiplier for next matching tag (Ren: Awen: Manifold)
    multi: {
        required: ['factor'], optional: ['tag', 'requires', 'requires.tag', 'requires.amount', 'requires.consume'],
        resolve(ctx) {
            const p: any = ctx.params || {};
            const factor = Math.max(1, Number(p.factor ?? 1));
            // Validator-style guard: do nothing on no-op factor
            if (factor <= 1) {
                ctx.state.log.push('Warning: Multi set with factor 1 — no effect.');
                return;
            }
            // Support wildcard next-card via tag='*' (default to '*')
            const tag = (p.tag ?? '*') as string; // '*' applies to the very next card regardless of tag

            // Requirement checks/hand mutations are handled in combat.ts (Manifold discard step)
            ctx.state.player.buffs = ctx.state.player.buffs || {};
            const buffs: any = ctx.state.player.buffs;
            buffs.multi = buffs.multi || {};
            buffs.multi[tag] = factor; // overwrite (no stacking)

            const scope = tag === '*' ? 'next card' : `next ${tag}`;
            ctx.state.log.push(`Multi set: ${scope} ×${factor}.`);
        }
    },
    cantAct: { required: ['cantAct'] },
    extraHit: { required: ['extraHit.condition.form', 'extraHit.hits'], optional: ['extraHit.damage'] },
    selfDamage: { required: ['cost.hp'], optional: ['cost.unpreventable'] },
};
export const effects = EFFECTS;
(EFFECTS as any).expose = EFFECTS.exposed; // alias in case any card uses 'expose'

const CORE_KEYS = ['damage', 'block', 'draw'] as const;

function hasPath(obj: any, path: string): boolean {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || !(p in cur)) return false;
        cur = cur[p];
    }
    return true;
}

function deriveEffects(c: CardSpec): EffectKey[] {
    const out = new Set<EffectKey>(c.effect ?? []);
    const p = (c.params ?? {}) as CardParams;
    for (const k of CORE_KEYS) if (k in p) out.add(k as EffectKey);
    return Array.from(out);
}

const DEFAULT_GENERATES: Partial<Record<CardKey, CardKey>> = {
    IronSummoningCauldron: 'AwenEmpower',
    Jabberwock: 'VorpalSlash',
};

type GenParams = {
    cardId?: CardKey;
    tag?: string;
    owner?: string | string[];
    name?: string;
    pool?: string | string[];
    count?: number;
};

export function resolveGeneratedCardIdInEffects(
    sourceKey: CardKey,
    effectKey: 'addCardToHand' | 'addEachTurn',
    params: GenParams = {}
): CardKey | null {
    if (params.cardId && CARD_SPECS[params.cardId]) return params.cardId;

    const entries = Object.entries(CARD_SPECS) as Array<[CardKey, any]>;
    const matches = entries
        .filter(([_, spec]) => {
            if (params.tag && !spec.tags?.includes(params.tag)) return false;
            if (params.owner) {
                const want = Array.isArray(params.owner) ? params.owner : [params.owner];
                if (!spec.owners || !want.some(w => spec.owners!.includes(w))) return false;
            }
            if (params.name) {
                const needle = params.name.toLowerCase();
                if (!spec.name?.toLowerCase().includes(needle)) return false;
            }
            if (params.pool) {
                const pools = Array.isArray(params.pool) ? params.pool : [params.pool];
                if (!spec.pools || !pools.some(p => spec.pools!.includes(p))) return false;
            }
            return true;
        })
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    if (matches.length) return matches[0][0];

    const fallback = DEFAULT_GENERATES[sourceKey];
    return fallback && CARD_SPECS[fallback] ? fallback : null;
}

export function resolveGeneratedCardNameInEffects(
    sourceKey: CardKey,
    effectKey: 'addCardToHand' | 'addEachTurn',
    params: GenParams = {}
): string | null {
    const id = resolveGeneratedCardIdInEffects(sourceKey, effectKey, params);
    return id ? (CARD_SPECS[id]?.name ?? id) : null;
}

type ValidationIssue = { card: string; issue: string };

// And in your validator, allow negative amounts (only flag when exactly zero):
function validateCard(id: string, c: CardSpec): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const effects = deriveEffects(c);
    const p = (c.params ?? {}) as CardParams;
    for (const ef of effects) {
        const spec = EFFECTS[ef as EffectKey];
        if (!spec) continue;
        for (const req of spec.required) {
            if (!hasPath(p, req)) issues.push({ card: id, issue: `missing ${ef}.${req}` });
        }
    }
    if (effects.includes('empower' as EffectKey) || effects.includes('gainEmpower' as EffectKey)) {
        const amt = Number((p as any)?.amount ?? (p as any)?.plus?.amount ?? 0);
        if (amt === 0) issues.push({ card: id, issue: 'empower.amount should not be 0' });
    }
    return issues;
}

function validateAll(specs: CardSpecs): ValidationIssue[] {
    const out: ValidationIssue[] = [];
    for (const id of Object.keys(specs)) out.push(...validateCard(id, specs[id]));
    return out;
}

// --- Multi replay helpers (Double/Triple = play N times) ---

function getCardTags(cardOrKey: CardSpec | CardKey): string[] {
    if (typeof cardOrKey === 'string') {
        const spec = CARD_SPECS[cardOrKey as CardKey];
        return spec?.tags ?? [];
    }
    return (cardOrKey?.tags as string[] | undefined) ?? [];
}

/**
 * Reads player.buffs.multi (stored by EFFECTS.multi) and returns the
 * repeat count for a given card based on matching tag. Default is 1.
 *
 * Priority:
 *  - Exact tag match in buffs.multi (first match wins based on card's tag order)
 *  - Fallback to '*' if present to allow "any card" Multi
 */
export function getRepeatCountForCard(state: any, cardOrKey: CardSpec | CardKey): number {
    const multi = state?.player?.buffs?.multi as Record<string, number> | undefined;
    if (!multi) return 1;

    const tags = getCardTags(cardOrKey);
    for (const t of tags) {
        const f = multi[t];
        if (typeof f === 'number' && f > 1) return Math.floor(f);
    }
    const any = multi['*'];
    return typeof any === 'number' && any > 1 ? Math.floor(any) : 1;
}

/**
 * Consumes the Multi entry for this card (removes the first matching tag entry
 * or '*' fallback). Call this ONCE after all repeats have resolved.
 */
export function consumeMultiForCard(state: any, cardOrKey: CardSpec | CardKey): void {
    const multi = state?.player?.buffs?.multi as Record<string, number> | undefined;
    if (!multi) return;

    const tags = getCardTags(cardOrKey);
    for (const t of tags) {
        if (t in multi) { delete multi[t]; return; }
    }
    if ('*' in multi) delete multi['*'];
}

export { deriveEffects, validateCard, validateAll };

/** Compute damage after status multipliers (no block, no HP apply). */
export function computeAttackDamage(
    state: CombatState,
    source: 'player' | 'enemy' | string,
    target: 'player' | 'enemy' | string,
    base: number
): number {
    const srcKey = source === 'player' ? 'player' : 'enemy';
    const dstKey = target === 'player' ? 'player' : 'enemy';
    const out = getOutgoingMultiplier ? getOutgoingMultiplier(state as any, srcKey) : 1;
    const inn = getIncomingMultiplier ? getIncomingMultiplier(state as any, dstKey) : 1;
    const val = Math.floor(Math.max(0, base) * out * inn);
    return val < 0 ? 0 : val;
}

/** Apply a status to 'player', the compat 'enemy', or a specific enemy id. */
export function applyStatusToId(
    state: CombatState,
    who: 'player' | 'enemy' | string,
    key: string,
    payload: { stacks?: number;[k: string]: any }
) {
    if (who === 'player' || who === 'enemy') {
        addStatus(state as any, who, key, payload);
        return;
    }
    const found = state.enemies?.find(e => e.id === who);
    if (!found) return;
    const old = (state as any).enemy;
    (state as any).enemy = found; // reuse existing status helpers
    addStatus(state as any, 'enemy', key, payload);
    (state as any).enemy = old;
}

/** Gain block on an entity by id. */
export function gainBlockOnId(state: CombatState, who: 'player' | 'enemy' | string, amount: number) {
    const amt = Math.max(0, Math.floor(amount || 0));
    if (who === 'player') {
        state.player.block = (state.player.block ?? 0) + amt;
        return;
    }
    if (who === 'enemy') {
        (state as any).enemy.block = ((state as any).enemy.block ?? 0) + amt;
        return;
    }
    const found = state.enemies?.find(e => e.id === who);
    if (found) found.block = (found.block ?? 0) + amt;
}

/** Heal an entity by id (clamped to maxHp when available). */
export function healId(state: CombatState, who: 'player' | 'enemy' | string, amount: number) {
    const amt = Math.max(0, Math.floor(amount || 0));
    if (who === 'player') {
        state.player.hp = Math.max(0, state.player.hp + amt);
        return;
    }
    if (who === 'enemy') {
        const e = (state as any).enemy;
        if (!e) return;
        e.hp = Math.min((e.maxHp ?? e.hp + amt), e.hp + amt);
        return;
    }
    const found = state.enemies?.find(e => e.id === who);
    if (found) found.hp = Math.min((found.maxHp ?? found.hp + amt), found.hp + amt);
}

