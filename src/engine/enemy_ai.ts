// enemy_ai.ts — lightweight, pluggable enemy decision policies
// Runtime-only: reads CombatState, looks at EnemySpec (from content/enemies),
// and returns an intent compatible with combat.ts: { kind, value?, status? }.
//
// Note: We avoid importing combat.ts to keep the graph acyclic. combat.ts calls
// chooseIntent() to fill enemy.intents, and then uses its own applyEnemyIntent().

import type { EnemySpec, EnemyAIKey } from '../content/enemies';
import { CARD_SPECS, type CardId } from '../content/card_specs';

// Mirror of the intent shape used in combat.ts (keep in sync as you extend it)
export type Intent =
    | { kind: 'playCard'; cardId: CardId; targetId?: string }
    | { kind: 'attack'; value: number; hits?: number }
    | { kind: 'defend'; value: number }
    | { kind: 'debuff'; status: { key: string; stacks: number } }
    | { kind: 'buff'; status: { key: string; stacks: number }; targetId?: string } // planned: ally buffs
    | { kind: 'heal'; value: number; targetId?: string }
    | { kind: 'idle' };

// Minimal view of an enemy inside CombatState — we only read a few fields
export type EnemyView = {
    id: string;
    name?: string;
    hp: number;
    maxHp?: number;
    block?: number;
    statuses?: Record<string, { stacks?: number }>;
};

export type CombatView = {
    turn: number;
    rngSeed: number;
    player: { hp: number; block: number; statuses?: Record<string, { stacks?: number }> };
    enemies: EnemyView[];
};

// Deterministic PRNG (same as mulberry32 used elsewhere) to keep seeds stable
function mulberry32(a: number) {
    return function () {
        let t = (a += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function strHash(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

// --- Policy entry point -----------------------------------------------------
export function chooseIntent(state: CombatView, enemy: EnemyView, spec: EnemySpec): Intent {
    const skills: CardId[] = (spec as any).skills ?? (spec as any).deck ?? [];
    const valid = Array.isArray(skills) ? skills.filter(cid => (CARD_SPECS as any)[cid]) : [];

    if (valid.length) {
        // Prefer not to buff the player: filter out cards whose params.target === 'self'/'ally' ONLY IF you intend to attack early
        const attackish = valid.filter(cid => (CARD_SPECS as any)[cid]?.type === 'Attack'
            || (CARD_SPECS as any)[cid]?.params?.target === 'enemy');

        const pool = attackish.length ? attackish : valid;

        // Mix turn into RNG so it doesn't pick the same card every time
        const r = seeded({ ...state, turn: (state.turn ?? 1) }, enemy);
        const picked = pool[Math.floor(r() * pool.length)];
        return { kind: 'playCard', cardId: picked, targetId: 'player' };
    }

    if (Array.isArray(skills) && skills.length > 0) {
        const r = seeded(state, enemy);
        const picked = skills[Math.floor(r() * skills.length)];
        return { kind: 'playCard', cardId: picked, targetId: 'player' };
    }
    const policy = POLICIES[spec.ai] || POLICIES.BasicAggro;
    // just before returning any intent
    console.log('[AI] chooseIntent:', enemy.name || enemy.id, intentOrCardIdHere);
    return policy(state, enemy, spec);
}

// --- Policies ---------------------------------------------------------------

type Policy = (state: CombatView, enemy: EnemyView, spec: EnemySpec) => Intent;

const POLICIES: Record<EnemyAIKey, Policy> = {
    BasicAggro(state, enemy, spec) {
        const r = seeded(state, enemy);
        const dmgBase = Math.max(1, Math.floor((spec.baseDamage ?? 5) * (spec.modifiers?.dmgMult ?? 1)));
        const lowBlock = (enemy.block ?? 0) < 4;
        // 70% attack, 30% defend (favor blocking if we currently have little block)
        const attackBias = lowBlock ? 0.55 : 0.7;
        if (r() < attackBias) return { kind: 'attack', value: dmgBase };
        return { kind: 'defend', value: 6 };
    },

    CasterTempo(state, enemy, spec) {
        const r = seeded(state, enemy);
        const dmgBase = Math.max(1, Math.floor((spec.baseDamage ?? 4) * (spec.modifiers?.dmgMult ?? 1)));
        // 35% debuff (Weak), 45% attack, 20% defend
        const x = r();
        if (x < 0.35) return { kind: 'debuff', status: { key: 'Weak', stacks: 1 } };
        if (x < 0.80) return { kind: 'attack', value: dmgBase };
        return { kind: 'defend', value: 6 };
    },

    Supportive(state, enemy, spec) {
        const r = seeded(state, enemy);
        const allies = state.enemies.filter(e => e.id !== enemy.id && (e.hp ?? 0) > 0);
        if (allies.length === 0) {
            // No allies alive: defend or debuff a bit
            return r() < 0.5 ? { kind: 'defend', value: 7 } : { kind: 'debuff', status: { key: 'Weak', stacks: 1 } };
        }

        const byPct = (a: EnemyView, b: EnemyView) => pct(a) - pct(b);
        const byBlock = (a: EnemyView, b: EnemyView) => (a.block ?? 0) - (b.block ?? 0);

        const lowestHpAlly = [...allies].sort(byPct)[0];
        const lowestBlockAlly = [...allies].sort(byBlock)[0];

        // 1) Heal injured ally most of the time
        if (pct(lowestHpAlly) < 0.6 && r() < 0.7) {
            return { kind: 'heal', value: 6, targetId: lowestHpAlly.id };
        }

        // 2) Otherwise grant Block to the squishiest-block ally
        if ((lowestBlockAlly.block ?? 0) < 6 && r() < 0.6) {
            return { kind: 'buff', status: { key: 'Block', stacks: 6 }, targetId: lowestBlockAlly.id };
        }

        // 3) Otherwise give Empower to the weakest ally to set up their attacks
        if (r() < 0.8) {
            return { kind: 'buff', status: { key: 'Empower', stacks: 1 }, targetId: lowestHpAlly.id };
        }

        // 4) Small chance to debuff the player
        return { kind: 'debuff', status: { key: 'Weak', stacks: 1 } };
    },


    BossPhase1(state, enemy, spec) {
        // simple opener: heavy attack more often; switch to Phase2 when <50% HP
        if (pct(enemy) <= 0.5) return POLICIES.BossPhase2(state, enemy, spec);
        const r = seeded(state, enemy);
        const dmgBase = Math.max(2, Math.floor((spec.baseDamage ?? 7) * (spec.modifiers?.dmgMult ?? 1)));
        if (r() < 0.75) return { kind: 'attack', value: dmgBase + 2 };
        return { kind: 'defend', value: 8 };
    },

    BossPhase2(state, enemy, spec) {
        // enraged: more attacks, occasional debuff
        const r = seeded(state, enemy);
        const dmgBase = Math.max(3, Math.floor((spec.baseDamage ?? 7) * (spec.modifiers?.dmgMult ?? 1)) + 2);
        const x = r();
        if (x < 0.15) return { kind: 'debuff', status: { key: 'Weak', stacks: 1 } };
        if (x < 0.85) return { kind: 'attack', value: dmgBase };
        return { kind: 'defend', value: 10 };
    },
};

// --- helpers ----------------------------------------------------------------
function seeded(state: CombatView, enemy: EnemyView) {
    return mulberry32((state.rngSeed ^ state.turn ^ strHash(enemy.id)) >>> 0);
}
function pct(e: EnemyView) {
    const max = e.maxHp ?? e.hp;
    return max <= 0 ? 0 : e.hp / max;
}
