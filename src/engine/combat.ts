// Minimal single-enemy combat loop (MVP)
import { CARD_SPECS, type CardId } from "../content/card_specs";
import { CHARACTERS } from "../content/characters";
import { buildStarterDeck } from "./deck";
import { mulberry32 } from "./rng";
import { getForm, changeForm } from "./forms";
import {
    addStatus,
    decayStatusesPerTurn,
    listStatuses as listStatusesFromStatus,
    onBeforeHitReduce,
    getEndTurnDamage,
    applyConditionalParams as applyConditionalStatusParams,
    canPlayChecker,
    getOutgoingMultiplier,
    getIncomingMultiplier,
} from "./status";
import { statusIdFromParamKey } from "./helpers";
import { factorLabel } from "./helpers";
import { EFFECTS as EFFECT_REG, getRepeatCountForCard, consumeMultiForCard } from "./effects";
// NEW: encounter helpers (adjust paths if needed)
import { getEncounterById, clampEncounter } from "./encounters";
import type { EnemySpec } from "../content/enemies";
import { chooseIntent } from "./enemy_ai";
import { log, type LogEvent } from './logger';
import { logStatusSnapshot, logDamageTrace } from './logger';

export { getForm, changeForm } from "./forms";

type AnyCardSpec =
    (typeof CARD_SPECS)[keyof typeof CARD_SPECS] & {
        keywords?: readonly string[];
        tags?: readonly string[];
        text?: string;
        effect?: string | readonly string[];
    };
type CharacterKey = keyof typeof CHARACTERS;

// Shared shapes for statuses/buffs
export type StatusMap = Record<string, { stacks?: number; duration?: number;[k: string]: any }>;
export type BuffMap = Record<string, { value?: number; duration?: number;[k: string]: any }>;


// ---- State ----
export type EnemyEntity = {
    id: string;
    name?: string;
    hp: number;
    maxHp?: number;
    block?: number;
    form: 'Ash' | 'Ember' | null;
    statuses: StatusMap;
    buffs: BuffMap;
    intents?: Array<{
        kind: 'attack' | 'defend' | 'buff' | 'debuff' | 'heal' | 'idle' | 'playCard';
        value?: number;
        hits?: number;
        status?: { key: string; stacks: number };
        targetId?: string;
        cardId?: CardId;
    }>;

};

export type CombatState = {
    turn: number;
    rngSeed: number;
    player: {
        id: string;
        hp: number;
        block: number;
        energy: number;
        energyMax: number;
        drawPerTurn: number;
        form: 'Ash' | 'Ember' | null;
        statuses: StatusMap;
        buffs: BuffMap;
    };
    // NEW: multi-enemy support (Phase 0/1)
    enemies: EnemyEntity[];
    // TEMP compat alias so existing code keeps working this phase
    enemy: EnemyEntity;
    draw: CardId[];
    discard: CardId[];
    exhaust: CardId[];
    hand: CardId[];
    log: string[];
};

// ---- Core ops ----

// Normalize anything (id string or object) to a spec id key.
function cardIdOf(x: any): string {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object') return x.id ?? x.cardId ?? x.cid ?? x.key ?? '';
    return String(x);
}

// Initialize a new combat (named export expected by UI)
export function initCombat(startChar: CharacterKey = 'Winnifred', opts?: { seed?: number; enemyHp?: number }): CombatState {
    const seed = opts?.seed ?? 12345;

    // Build a starting deck
    const deck: CardId[] = (buildStarterDeck as any)(startChar);

    // Shuffle the draw pile deterministically by seed so opening hand depends on seed
    const initialDraw = shuffle(deck.slice(), seed);

    const st: CombatState = {
        turn: 1,
        rngSeed: seed,
        player: {
            id: 'player',
            hp: 70,
            block: 0,
            energy: 3,
            energyMax: 3,
            drawPerTurn: 5,
            form: null,
            statuses: {},
            buffs: {},
        },
        enemies: [],
        // compat alias filled after enemies[]
        enemy: undefined as unknown as EnemyEntity,
        draw: initialDraw,
        discard: [],
        exhaust: [],
        hand: [],
        log: [],
    };

    if (!st.events) st.events = [];
    if (!st.log) st.log = [];
    log(st, { kind: 'turn:start', turn: st.turn });

    // Build enemies from content/encounters
    const specs: EnemySpec[] = clampEncounter(getEncounterById('trio_goblin_kobold_mandragora'));

    st.enemies = specs.map((s, i) => ({
        id: `enemy-${i + 1}`,
        name: s.name,
        hp: s.hpMax,
        maxHp: s.hpMax,
        block: 0,
        form: null,
        statuses: {},
        buffs: {},
        intents: [],
    }));

    // Stash a spec map for AI (keeps EnemyEntity lean without new fields)
    const _specById: Record<string, EnemySpec> = {};
    st.enemies.forEach((e, i) => { _specById[e.id] = specs[i]; });
    (st as any)._enemySpecsById = _specById;

    // Compat alias expected by some helpers
    st.enemy = st.enemies[0];

    // Safety: hard-cap to 3 in case the encounter lists more
    if (st.enemies.length > 3) st.enemies = st.enemies.slice(0, 3);

    // Initial hand draw
    drawCards(st, st.player.drawPerTurn);

    // Roll first intents so UI can show them during player's first turn
    try {
        for (const en of st.enemies) {
            // rollEnemyIntent is defined later in this module
            // (guard in case it is not yet present during some builds)
            const nextIntent = (typeof (rollEnemyIntent as any) === 'function') ? (rollEnemyIntent as any)(st, en) : { kind: 'attack', value: 5 };
            en.intents = [nextIntent];
        }
    } catch { /* ignore */ }
    return st;
}

// ---- Core ops ----
// Deterministic shuffle using the same PRNG as the rest of the engine
function shuffle<T>(arr: T[], seed: number): T[] {
    const rng = mulberry32((seed >>> 0));
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]] as [T, T];
    }
    return a;
}
export function drawCards(st: CombatState, n: number): void {
    for (let i = 0; i < n; i++) {
        if (st.draw.length === 0) {
            if (st.discard.length === 0) break;
            // Reshuffle discard -> draw
            const moved = st.discard.slice();
            st.draw = shuffle(moved, st.rngSeed + st.turn); // slight salt by turn
            st.discard = [];
            log(st, { kind: 'diag', msg: 'Reshuffled discard into draw.' });
        }
        // Draw one card: draw -> hand
        const id = st.draw.pop()!;
        st.hand.push(id);
        log(st, { kind: 'pile:move', cardId: id, from: 'draw', to: 'hand' });
    }
}

import { log, logStatusSnapshot } from '../engine/logger';

export function playCard(st: CombatState, handIndex: number, targetId?: string): boolean {
    const entry = st.hand[handIndex];
    const id = cardIdOf(entry);
    if (!id) return false;

    const spec = (CARD_SPECS as any)[id] as AnyCardSpec;
    const cost = spec.cost ?? 0;
    const baseParams = (spec as any).params ?? {};

    // ── Gate: requireStatus (e.g., Diebandersnatch)
    if (Array.isArray(spec.effect) && spec.effect.includes('requireStatus')) {
        const req = (baseParams as any)?.requires;
        const rawKey = req?.status;
        if (typeof rawKey === 'string') {
            const need = statusIdFromParamKey(rawKey);
            const tgt = targetId ? resolveWho(st, targetId).ref : st.enemy;
            const stacks = tgt?.statuses?.[need]?.stacks ?? 0;
            if (stacks <= 0) {
                log(st, {
                    kind: 'card:unplayable',
                    who: 'player',
                    cardId: spec.id ?? spec.cardId ?? spec.name,
                    cardName: spec.name,
                    reason: `requires enemy to have ${need}`,
                    requirement: { type: 'status', key: need, on: tgt?.id },
                });
                return false;
            }
        }
    }

    // ── Energy gate
    if (cost > st.player.energy) {
        log(st, {
            kind: 'card:unplayable',
            who: 'player',
            cardId: spec.id ?? spec.cardId ?? spec.name,
            cardName: spec.name,
            reason: `not enough energy (need ${cost})`,
        });
        return false;
    }

    // ── Pay cost
    const energyBefore = st.player.energy;
    st.player.energy -= cost;
    const energyAfter = st.player.energy;

    // ── Card play event (carries E before/after)
    log(st, {
        kind: 'card:play',
        who: 'player',
        cardId: spec.id ?? spec.cardId ?? spec.name,
        cardName: spec.name,
        target: targetId,
        aoe: !!spec.aoe,
        energyBefore,
        energyAfter,
    });

    // ── Special case for Manifold (Awen with 'multi'): discard other Awen BEFORE resolves
    if (Array.isArray(spec.effect) && spec.effect.includes('multi') && (spec.tags ?? []).includes('Awen')) {
        for (let i = st.hand.length - 1; i >= 0; i--) {
            const entryI = st.hand[i];
            const cid = cardIdOf(entryI);
            if (cid === id) continue;
            const s = (CARD_SPECS as any)[cid] as AnyCardSpec;
            if ((s?.tags ?? []).includes('Awen')) {
                st.discard.push(cid);
                st.hand.splice(i, 1);
                // log the actual card id we just moved
                log(st, { kind: 'pile:move', cardId: cid, from: 'hand', to: 'discard' });
            }
        }
    }

    // ── Compute global Empower (status-based)
    const getEmpower = () => (st.player?.statuses?.Empower?.stacks ?? 0);

    // ── Determine repeat count
    const repeatCount = Math.max(1, getRepeatCountForCard(st as any, spec as any));

    // Local helpers
    const saysBlock = /block/i.test(spec.text ?? '') || spec.name === 'Guard';

    const baseDamage = typeof (baseParams as any).damage === 'number'
        ? (baseParams as any).damage
        : (typeof (baseParams as any).base === 'number' && spec.type === 'Attack' ? (baseParams as any).base : 0);

    const baseBlock = typeof (baseParams as any).block === 'number'
        ? (baseParams as any).block
        : (typeof (baseParams as any).base === 'number' && saysBlock ? (baseParams as any).base : 0);

    // ---- One full resolution of the card (effects + statuses + logs)
    const resolveOnce = () => {
        const params = baseParams;
        const tgtList = resolveTargetsForCardPlay(st, 'player', params, targetId);
        const targets: string[] = tgtList.length ? tgtList : [];
        const chosenTarget = targets[0] || firstAliveEnemyId(st) || 'enemy';
        const formAtPlay = getForm(st, 'player');

        const effectList: string[] = Array.isArray(spec.effect) ? (spec.effect as any) : (spec.effect ? [spec.effect] : []);
        let didAttack = false;

        // 2) Switch-based bespoke effects (per repeat)
        for (const ef of effectList) {
            switch (ef) {
                case 'changeAsh':
                    changeForm(st, 'player', 'Ash');
                    break;
                case 'changeEmber':
                    changeForm(st, 'player', 'Ember');
                    break;

                case 'selfDamage': {
                    const hpCost = Number((params as any)?.cost?.hp ?? 0);
                    if (hpCost > 0) {
                        const hpBefore = st.player.hp;
                        const blocked = 0; // self-damage ignores block by design; change if needed
                        const final = Math.min(hpCost, hpBefore);
                        st.player.hp = Math.max(0, hpBefore - final);
                        (st.player as any).turnDamageTaken = ((st.player as any).turnDamageTaken ?? 0) + final;

                        log(st, {
                            kind: 'damage',
                            source: 'player',
                            target: 'player',
                            base: hpCost,
                            modified: final,
                            blocked,
                            hpBefore,
                            hpAfter: st.player.hp,
                        });
                    }
                    break;
                }

                case 'hitsPerTag': {
                    const tag = (params as any)?.tag;
                    const per = Number((params as any)?.damagePer ?? 0);
                    if (tag && per > 0) {
                        const countInHand = st.hand
                            .map(h => (CARD_SPECS as any)[cardIdOf(h)] as AnyCardSpec)
                            .filter(s => (s.tags ?? []).includes(tag))
                            .length;

                        const emp = getEmpower();
                        const perHit = Math.max(0, Math.floor(per + emp));
                        const total = Math.max(0, Math.floor(countInHand * perHit));

                        if (total > 0) {
                            let sum = 0;
                            for (const tid of targets) {
                                const hit = dealDamage(st, 'player', tid, total);
                                const tgtRef = resolveWho(st, tid).ref;
                                const hpBefore = (hit.hpBefore != null) ? hit.hpBefore : (tgtRef.hp + hit.dealt);
                                const hpAfter = (hit.hpAfter != null) ? hit.hpAfter : tgtRef.hp;
                                const blocked = Math.max(0, (hit.blocked ?? 0));

                                log(st, {
                                    kind: 'damage',
                                    source: 'player',
                                    target: tgtRef.id,
                                    base: total,
                                    modified: hit.dealt,
                                    blocked,
                                    hpBefore,
                                    hpAfter,
                                });

                                sum += hit.dealt;
                            }
                            const empNote = emp ? ` • Empower +${emp}×${countInHand}` : '';
                            log(st, { kind: 'diag', msg: `hitsPerTag: ${countInHand} ${tag} in hand → ${per} per hit${empNote} ⇒ dealt ${sum} total.` });
                            didAttack = true;
                        } else {
                            log(st, { kind: 'diag', msg: `Played ${spec.name}: no ${tag} in hand.` });
                        }
                    }
                    break;
                }

                case 'extraHit': {
                    const p: any = params || {};
                    const baseHits = Math.max(0, Number(p.hits ?? 1));
                    const baseDmg = Math.max(0, Number(p.damage ?? 0));
                    const condForm = p.extraHit?.condition?.form as ('Ash' | 'Ember' | undefined);
                    const extraHits = condForm && formAtPlay === condForm ? Math.max(0, Number(p.extraHit?.hits ?? 0)) : 0;
                    const extraDmg = Math.max(0, Number(p.extraHit?.damage ?? 0));
                    const emp = getEmpower();

                    const perBase = Math.max(0, Math.floor(baseDmg + emp));
                    const perExtra = Math.max(0, Math.floor(extraDmg + emp));
                    const total = baseHits * perBase + extraHits * perExtra;

                    if (total > 0) {
                        let sum = 0;
                        for (const tid of targets) {
                            const hit = dealDamage(st, 'player', tid, total);
                            const tgtRef = resolveWho(st, tid).ref;
                            const hpBefore = (hit.hpBefore != null) ? hit.hpBefore : (tgtRef.hp + hit.dealt);
                            const hpAfter = (hit.hpAfter != null) ? hit.hpAfter : tgtRef.hp;
                            const blocked = Math.max(0, (hit.blocked ?? 0));

                            log(st, {
                                kind: 'damage',
                                source: 'player',
                                target: tgtRef.id,
                                base: total,
                                modified: hit.dealt,
                                blocked,
                                hpBefore,
                                hpAfter,
                            });

                            sum += hit.dealt;
                        }
                        const extraNote = extraHits > 0 ? ` + ${extraDmg}×${extraHits}` : '';
                        const empNote = emp ? ` • Empower +${emp} per hit` : '';
                        log(st, { kind: 'diag', msg: `extraHit: ${baseDmg}×${baseHits}${extraNote}${empNote} ⇒ dealt ${sum} total.` });
                        didAttack = true;
                    } else {
                        log(st, { kind: 'diag', msg: `Played ${spec.name}: (no damage).` });
                    }
                    break;
                }

                case 'dissociation': {
                    const cur = getForm(st, 'player');
                    if (!cur) {
                        log(st, { kind: 'diag', msg: 'Played Dissociation: (no MVP effect yet).' });
                    } else {
                        changeForm(st, 'player', cur === 'Ash' ? 'Ember' : 'Ash');
                    }
                    break;
                }

                case 'ashScales': {
                    const stacks = (params as any).duration ?? 3;
                    const reduce = (params as any).reduceIncoming ?? 3;
                    addStatus(st, 'player', 'Scales', { label: 'Scales', stacks, reduceIncoming: reduce, consumePerHit: true, decayPerTurn: 1 });
                    break;
                }

                case 'difference': {
                    const src = (params as any)?.source;
                    const taken = (st.player as any).turnDamageTaken ?? 0;
                    const baseFromTaken = src === 'damageTakenThisTurn' ? taken : 0;
                    const emp = getEmpower();
                    const perHit = Math.max(0, Math.floor(baseFromTaken + emp));
                    if (perHit > 0) {
                        let sum = 0;
                        for (const tid of targets) {
                            const hit = dealDamage(st, 'player', tid, perHit);
                            const tgtRef = resolveWho(st, tid).ref;
                            const hpBefore = (hit.hpBefore != null) ? hit.hpBefore : (tgtRef.hp + hit.dealt);
                            const hpAfter = (hit.hpAfter != null) ? hit.hpAfter : tgtRef.hp;
                            const blocked = Math.max(0, (hit.blocked ?? 0));

                            log(st, {
                                kind: 'damage',
                                source: 'player',
                                target: tgtRef.id,
                                base: perHit,
                                modified: hit.dealt,
                                blocked,
                                hpBefore,
                                hpAfter,
                            });

                            sum += hit.dealt;
                        }
                        const empNote = emp ? ` • Empower +${emp}` : '';
                        log(st, { kind: 'diag', msg: `difference: dealt ${sum} from damage taken (${baseFromTaken})${empNote}.` });
                        didAttack = true;
                    } else {
                        log(st, { kind: 'diag', msg: `Played ${spec.name}: no damage to reflect.` });
                    }
                    break;
                }
            }
        }

        // Snapshot (kept as-is; UI can ignore if noisy)
        logStatusSnapshot(st, `after player card: ${spec?.name ?? id}`);

        // 3) Default Attack/Block branches (per repeat)
        if (spec.type === 'Attack' && !didAttack) {
            const base = Math.max(0, Math.floor(baseDamage || 0));
            const emp = getEmpower();
            const per = Math.max(0, Math.floor(base + emp));
            let sum = 0;
            for (const tid of targets) {
                const hit = dealDamage(st, 'player', tid, per);
                const tgtRef = resolveWho(st, tid).ref;
                const hpBefore = (hit.hpBefore != null) ? hit.hpBefore : (tgtRef.hp + hit.dealt);
                const hpAfter = (hit.hpAfter != null) ? hit.hpAfter : tgtRef.hp;
                const blocked = Math.max(0, (hit.blocked ?? 0));
                log(st, {
                    kind: 'damage',
                    source: 'player',
                    target: tgtRef.id,
                    base: per,
                    modified: hit.dealt,
                    blocked,
                    hpBefore,
                    hpAfter,
                });
                sum += hit.dealt;
            }
            const empNote = emp ? ` • Empower +${emp}` : '';
            log(st, { kind: 'diag', msg: `attack: dealt ${sum} total${empNote}.` });
        } else if (saysBlock) {
            const baseB = Math.max(0, Math.floor(baseBlock || 0));
            const bBefore = st.player.block;
            st.player.block += baseB;
            log(st, { kind: 'block:gain', target: 'player', amount: baseB, blockBefore: bBefore, blockAfter: st.player.block });
        }

        // After damage/block: run generic registry resolves
        (st as any).__playStamp = ((st as any).__playStamp ?? 0) + 1;
        const playStamp = (st as any).__playStamp;

        for (const key of effectList) {
            const desc: any = (EFFECT_REG as any)[key];
            if (desc?.resolve) {
                desc.resolve({
                    state: st,
                    actor: { id: 'player' },
                    spec,
                    params,
                    source: 'player',
                    target: chosenTarget,
                    playStamp,
                });
            }
        }

        // Consume 1 stack of required status if requested
        if (Array.isArray(spec.effect) && spec.effect.includes('requireStatus')) {
            const req = (baseParams as any)?.requires;
            if (req?.consume && typeof req.status === 'string') {
                const key = statusIdFromParamKey(req.status);
                const tgtEnt = resolveWho(st, chosenTarget).ref;
                const cur = tgtEnt?.statuses?.[key]?.stacks ?? 0;
                if (cur > 0) {
                    const next = cur - 1;
                    if (next <= 0) {
                        delete tgtEnt.statuses[key];
                    } else {
                        tgtEnt.statuses[key].stacks = next;
                    }
                    log(st, { kind: 'status:decay', target: tgtEnt.id, key, stepStacks: 1, resultStacks: Math.max(0, next), removed: next <= 0 });
                }
            }
        }

        // 5) Param-driven status application (after filtering)
        const suppress = new Set(effectList.map(k => String(k).toLowerCase()));
        const stripKeys = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;
            const out: any = Array.isArray(obj) ? [] : {};
            for (const k of Object.keys(obj)) {
                const v = obj[k];
                const lk = k.toLowerCase();
                if ((lk === 'weak' || lk === 'exposed' || lk === 'burning' || lk === 'empower') && suppress.has(lk)) {
                    continue;
                }
                if (lk === 'ifember' || lk === 'ifash') {
                    out[k] = stripKeys(v);
                    continue;
                }
                out[k] = (typeof v === 'object' && v) ? stripKeys(v) : v;
            }
            return out;
        };

        const filteredParams = stripKeys(baseParams);
        applyConditionalStatusParams(st, filteredParams, formAtPlay);

        // 6) End Turn keyword
        const hasKeyword = (kw: string) => {
            const kwds = (spec.keywords ?? []) as readonly string[];
            const tags = (spec.tags ?? []) as readonly string[];
            const inText = (spec.text ?? '').toLowerCase().includes(kw.toLowerCase());
            return kwds.includes(kw as any) || tags.includes(kw as any) || inText;
        };
        const isEndTurn = hasKeyword('End Turn') || hasKeyword('EndTurn');
        if (isEndTurn) endTurn(st);
    };

    // ── Resolve the card N times
    for (let i = 0; i < repeatCount; i++) resolveOnce();

    // ── After all repeats: consume Multi for this card ONCE
    consumeMultiForCard(st as any, spec as any);

    // ── Pile routing ONCE (Exhaust vs Discard). Remove from hand.
    const hasKeyword = (kw: string) => {
        const kwds = (spec.keywords ?? []) as readonly string[];
        const tags = (spec.tags ?? []) as readonly string[];
        const inText = (spec.text ?? '').toLowerCase().includes(kw.toLowerCase());
        return kwds.includes(kw as any) || tags.includes(kw as any) || inText;
    };
    const isExhaust = hasKeyword('Exhaust');

    // move the played card out of hand and log the move
    if (isExhaust) {
        st.exhaust.push(id);
        log(st, { kind: 'pile:move', cardId: id, from: 'hand', to: 'exhaust' });
    } else {
        st.discard.push(id);
        log(st, { kind: 'pile:move', cardId: id, from: 'hand', to: 'discard' });
    }

    if (handIndex >= 0 && handIndex < st.hand.length) st.hand.splice(handIndex, 1);

    return true;
}


export function canPlayCard(st: CombatState, handIndex: number, targetId?: string): { ok: boolean; reason?: string } {
    const entry = st.hand[handIndex];
    const id = cardIdOf(entry);
    if (!id) return { ok: false, reason: 'No card' };
    const spec = (CARD_SPECS as any)[id] as AnyCardSpec;
    const cost = spec.cost ?? 0;
    if (cost > st.player.energy) return { ok: false, reason: `Need ${cost} energy` };
    // NEW: requireStatus gate (e.g., Diebandersnatch)
    const params = (spec as any).params ?? {};
    if (Array.isArray(spec.effect) && spec.effect.includes('requireStatus')) {
        const raw = (params as any)?.requires?.status;
        if (typeof raw === 'string') {
            const need = statusIdFromParamKey(raw);
            const tgt = targetId ? resolveWho(st, targetId).ref : st.enemy;
            const stacks = tgt?.statuses?.[need]?.stacks ?? 0;
            if (stacks <= 0) return { ok: false, reason: `Requires ${need}` };
        }
    }
    const gate = canPlayChecker(st, spec);
    if (!gate.ok) return gate;
    return { ok: true };
}

// Utility
function resolveWho(st: CombatState, whoId: string): { key: 'player' | 'enemy'; ref: any } {
    if (whoId === 'player') return { key: 'player', ref: st.player };
    // explicit main enemy alias
    if (whoId === 'enemy') return { key: 'enemy', ref: st.enemy };
    // attempt to resolve by enemy id in array
    const found = st.enemies.find(e => e.id === whoId);
    if (found) return { key: 'enemy', ref: found };
    // fallback
    return { key: 'player', ref: st.player };
}

export function dealDamage(
    st: CombatState,
    srcId: string,
    dstId: string,
    baseDamage: number
): { dealt: number; usedBlock: number; red: number } {
    const src = resolveWho(st, srcId);
    const dst = resolveWho(st, dstId);
    let dmg = Math.max(0, Math.floor(baseDamage || 0));

    const isStatusSource = typeof srcId === 'string' && srcId.startsWith('status:');

    // --- Empower add (enemies only, StS Strength-like) ---
    let addEmpower = 0;
    if (!isStatusSource && src.key === 'enemy') {
        const old = st.enemy;
        st.enemy = src.ref;
        addEmpower = st.enemy?.statuses?.Empower?.stacks ?? 0;
        if (addEmpower > 0) dmg = Math.max(0, dmg + addEmpower);
        st.enemy = old;
    }

    // --- Multipliers (Weak/Exposed) ---
    let outMult = 1, inMult = 1;
    const oldEnemy = st.enemy;
    try {
        if (!isStatusSource) {                      // ← keep as-is
            if (src.key === 'enemy') st.enemy = src.ref;
            outMult = getOutgoingMultiplier(st as any, src.key);
            dmg = Math.floor(dmg * outMult);
        }
        if (!isStatusSource) {                      // ← NEW: block incoming on DoT/status sources
            if (dst.key === 'enemy') st.enemy = dst.ref;
            inMult = getIncomingMultiplier(st as any, dst.key);
            dmg = Math.floor(dmg * inMult);
        }
    } finally { st.enemy = oldEnemy; }


    const preReductions = dmg;

    // --- Flat reductions (Scales etc.) ---
    const before = onBeforeHitReduce(st as any, dst.key, dmg);
    dmg = before.dmg;
    const flatReduced = before.reduced;

    // --- Block soak ---
    const curBlock = dst.ref.block ?? 0;
    const usedBlock = Math.min(curBlock, dmg);
    dst.ref.block = curBlock - usedBlock;
    dmg -= usedBlock;

    // --- HP ---
    const dealt = Math.max(0, dmg);
    const hpBefore = dst.ref.hp ?? 0;
    if (dealt > 0) dst.ref.hp = Math.max(0, hpBefore - dealt);

    // TRACE
    logDamageTrace(st, {
        src: srcId, dst: dstId,
        base: Math.max(0, Math.floor(baseDamage || 0)),
        addEmpower,
        outMult,
        inMult,
        preReductions,
        flatReduced,
        blocked: usedBlock,
        final: dealt
    });

    return { dealt, usedBlock, red: flatReduced };
}

function playEnemyCard(st: CombatState, enemy: EnemyEntity, cardId: CardId, clickedTargetId?: string) {
  const spec = (CARD_SPECS as any)[cardId];

  if (!spec) {
    log(st, { kind: 'diag', msg: `${enemy.name ?? enemy.id} tried to use unknown card: ${String(cardId)}` });
    return;
  }

  const eBefore = (enemy as any).energy ?? 0;
  const cost = spec.cost ?? 0;
  const eAfter = Math.max(0, eBefore - cost); // fine even if you don't actually subtract

  log(st, {
    kind: 'card:play',
    who: enemy.id,
    cardId,
    cardName: spec.name,
    target: clickedTargetId,
    aoe: !!spec.aoe,
    energyBefore: eBefore,
    energyAfter: eAfter,
  });

  const params = (spec as any).params ?? {};
  const targets = resolveTargetsForCardPlay(st, enemy.id, params, clickedTargetId);
  if (!targets.length && (params.target ?? 'enemy') !== 'none') {
    log(st, { kind: 'diag', msg: `${enemy.name ?? enemy.id} tries to use ${String(cardId)}, but has no valid targets.` });
    return;
  }

  const keys = Array.isArray(spec.effect) ? spec.effect : (spec.effect ? [spec.effect] : []);
  let handled = false;

  (st as any).__playStamp = ((st as any).__playStamp ?? 0) + 1;
  const playStamp = (st as any).__playStamp;

  if (keys.length && (EFFECT_REG as any)) {
    let used = false;
    for (const k of keys) {
      const fn = (EFFECT_REG as any)[k];
      if (typeof fn === 'function') {
        fn(st as any, { actor: enemy.id, cardId, params, targets });
        used = true;
      } else if (fn?.resolve) {
        fn.resolve({
          state: st,
          actor: { id: enemy.id },
          spec,
          params,
          source: 'enemy',
          target: targets[0] ?? 'player',
          targets,
          playStamp,
        });
        used = true;
      }
    }
    handled = used;
  }

  // ---------------------------
  // Fallbacks (when no handler)
  // ---------------------------
  if (!handled) {
    const dmg = Number(params.damage ?? params.base ?? 0);
    const blk = Number(params.block ?? params.baseBlock ?? 0);
    const stat = (params as any).status;  // expect { key: string, stacks?: number, ... }
    const tgtKey = params.target ?? 'enemy';

    // 1) Damage fallback
    if (dmg > 0) {
      let sum = 0;
      for (const tId of targets) {
        const hit = dealDamage(st, enemy.id, tId, dmg);
        const tgtRef = resolveWho(st, tId).ref;
        const hpBefore = (hit.hpBefore != null) ? hit.hpBefore : (tgtRef.hp + hit.dealt);
        const hpAfter  = (hit.hpAfter  != null) ? hit.hpAfter  :  tgtRef.hp;
        const blocked  = Math.max(0, (hit.blocked ?? 0));

        log(st, {
          kind: 'damage',
          source: enemy.id,
          target: tgtRef.id,
          base: dmg,
          modified: hit.dealt,
          blocked,
          hpBefore,
          hpAfter,
        });
        sum += hit.dealt;
      }
      log(st, { kind: 'diag', msg: `${enemy.name ?? enemy.id} uses ${spec.name ?? String(cardId)}: dealt ${sum}.` });
    }

    // 2) Block fallback (applies to the acting enemy)
    if (blk > 0) {
      const bBefore = enemy.block ?? 0;
      enemy.block = Math.min((enemy.block ?? 0) + blk, (enemy as any).blockCap ?? 999);
      log(st, { kind: 'block:gain', target: enemy.id, amount: blk, blockBefore: bBefore, blockAfter: enemy.block });
    }

    // 3) Status fallback
    if (stat?.key) {
      const key = String(stat.key);
      const stacks = Number(stat.stacks ?? stat.delta ?? 1);

      // Decide recipients:
      // - If designer said target:'self' => apply to the acting enemy.
      // - If target:'ally' => apply to each resolved ally in `targets`.
      // - Otherwise apply to the resolved targets (often the player).
      const recipientIds: string[] =
        tgtKey === 'self' ? [enemy.id] :
        tgtKey === 'ally' ? targets :
        targets;

      for (const rid of recipientIds) {
        const ent = (rid === 'player') ? st.player : st.enemies.find(e => e.id === rid);
        if (!ent || (ent.hp ?? 0) <= 0) continue;

        // Apply stacks in state (simple additive; clamp or duration as needed)
        const before = ent.statuses?.[key]?.stacks ?? 0;
        const after = Math.max(0, before + stacks);
        ent.statuses = ent.statuses || {};
        ent.statuses[key] = { ...(ent.statuses[key] || {}), stacks: after };

        log(st, {
          kind: 'status:apply',
          target: rid,
          key,
          deltaStacks: stacks,
          resultStacks: after,
        });
      }
    }
  }
}

// --- Simple intent system (MVP) ---
function strHash(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

export function rollEnemyIntent(st: CombatState, enemy: EnemyEntity): EnemyEntity['intents'][number] {
    // Prefer data-driven AI via enemy_ai.chooseIntent when a spec is available
    const spec = (st as any)._enemySpecsById?.[enemy.id] as EnemySpec | undefined;
    if (spec) {
        const view = {
            turn: st.turn,
            rngSeed: st.rngSeed,
            player: { hp: st.player.hp, block: st.player.block, statuses: st.player.statuses },
            enemies: st.enemies.map(e => ({ id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, block: e.block, statuses: e.statuses })),
        } as any;
        const enemyView = { // <-- define it!
            id: enemy.id,
            name: enemy.name,
            hp: enemy.hp,
            maxHp: enemy.maxHp,
            block: enemy.block,
            statuses: enemy.statuses,
        };

        const intent = chooseIntent(view, {
            id: enemy.id,
            name: enemy.name,
            hp: enemy.hp,
            maxHp: enemy.maxHp,
            block: enemy.block,
            statuses: enemy.statuses
        }, spec) as any;

        if (intent?.kind === 'playCard' && intent.cardId) {
            return { kind: 'playCard', cardId: intent.cardId as CardId, targetId: intent.targetId } as any;
        }

        if (!intent) return { kind: 'idle' } as any;

        // NEW: pass-through for card-based intents
        if (intent.kind === 'playCard' && intent.cardId) {
            return { kind: 'playCard', cardId: intent.cardId as CardId, targetId: intent.targetId } as any;
        }
        // Map AI intent to engine intent shape
        if (!intent) return { kind: 'idle' } as any;
        if (intent.kind === 'attack') return { kind: 'attack', value: Math.max(0, Math.floor(intent.value ?? 0)) } as any;
        if (intent.kind === 'defend') return { kind: 'defend', value: Math.max(0, Math.floor(intent.value ?? 0)) } as any;
        if (intent.kind === 'debuff') return { kind: 'debuff', status: { key: intent.status?.key ?? 'Weak', stacks: intent.status?.stacks ?? 1 } } as any;
        if (intent.kind === 'buff') return { kind: 'buff', status: intent.status, targetId: intent.targetId } as any;
        if (intent.kind === 'heal') return { kind: 'heal', value: Math.max(0, Math.floor(intent.value ?? 0)), targetId: intent.targetId } as any;
        return { kind: 'idle' } as any;

        return { kind: 'idle' } as any;
    }

    // Fallback: simple seed-based random
    const rng = mulberry32((st.rngSeed ^ st.turn ^ strHash(enemy.id)) >>> 0);
    const r = rng();
    if (r < 0.5) {
        return { kind: 'attack', value: 5 };
    } else if (r < 0.8) {
        return { kind: 'defend', value: 6 };
    } else {
        return { kind: 'debuff', status: { key: 'Weak', stacks: 1 } };
    }
}

export function applyEnemyIntent(st: CombatState, enemy: EnemyEntity, intent: EnemyEntity['intents'][number]) {
    const name = enemy.name ?? 'Enemy';
    logStatusSnapshot(st, `before enemy intent ${enemy.name ?? enemy.id}`);
    //st.log.push(`[diag] Applying intent: ${intent.kind}${intent.cardId ? ' (' + intent.cardId + ')' : ''}`);
    log(st, { kind: 'intent:set', enemyId: enemy.id, intent });
    switch (intent.kind) {
        case 'attack': {
            const dmg = Math.max(0, Math.floor(intent.value ?? 0));
            const res = dealDamage(st, enemy.id, 'player', dmg);
            st.log.push(`${name} hits: dealt ${res.dealt}. Player HP ${st.player.hp}.`);
            break;
        }
        case 'defend': {
            const v = Math.max(0, Math.floor(intent.value ?? 0));
            const before = enemy.block ?? 0;
            enemy.block = (enemy.block ?? 0) + v;
            log(st, { kind: 'block:gain', target: enemy.id, amount: v, blockBefore: before, blockAfter: enemy.block ?? 0 });
            st.log.push(`${name} gains ${v} block (now ${enemy.block}).`);
            break;
        }
        case 'debuff': {
            const k = intent.status?.key ?? 'Weak';
            const stacks = intent.status?.stacks ?? 1;
            addStatus(st, 'player', k, { stacks });
            st.log.push(`${name} applies ${k} +${stacks} to Player.`);
            break;
        }
        case 'buff': {
            const targetId = intent.targetId && st.enemies.find(e => e.id === intent.targetId) ? intent.targetId : (st.enemies.find(e => e.id !== enemy.id && (e.hp ?? 0) > 0)?.id);
            if (!targetId) { st.log.push(`${name} looks for an ally to buff, but finds none.`); break; }
            const ally = st.enemies.find(e => e.id === targetId)!;
            if ((ally.hp ?? 0) <= 0) { st.log.push(`${name} tries to buff ${ally.name ?? 'Ally'}, but they are down.`); break; }
            const k = intent.status?.key ?? 'Empower';
            const stacks = intent.status?.stacks ?? 1;
            if (/^block$/i.test(k)) {
                const v = Math.max(0, Math.floor(stacks));
                const before = ally.block ?? 0;
                ally.block = (ally.block ?? 0) + v;
                log(st, { kind: 'block:gain', target: ally.id, amount: v, blockBefore: before, blockAfter: ally.block ?? 0 });
                st.log.push(`${name} grants ${v} Block to ${ally.name ?? 'Ally'} (now ${ally.block}).`);
            } else {
                // generic status buff on ally
                const old = st.enemy; st.enemy = ally as any;
                addStatus(st, 'enemy', k, { stacks });
                st.enemy = old;
                st.log.push(`${name} grants ${k} +${stacks} to ${ally.name ?? 'Ally'}.`);
            }
            break;
        }
        case 'heal': {
            const targetId =
                (intent.targetId && st.enemies.find(e => e.id === intent.targetId)) ? intent.targetId
                    : enemy.id; // fallback: self

            const tgt = st.enemies.find(e => e.id === targetId)!;
            // Don’t heal a downed target
            if ((tgt.hp ?? 0) <= 0) {
                st.log.push(`${name} tries to heal ${tgt.name ?? 'Ally'}, but they are down.`);
                break;
            }
            const amt = Math.max(0, Math.floor(intent.value ?? 0));
            if (amt > 0) {
                const max = tgt.maxHp ?? tgt.hp;
                const before = tgt.hp;
                tgt.hp = Math.min(max, tgt.hp + amt);
                st.log.push(`${name} heals ${tgt.name ?? 'Ally'} for ${amt} (HP ${before} → ${tgt.hp}).`);
            } else {
                st.log.push(`${name} tries to heal but it has no effect.`);
            }
            break;
        }
        case 'playCard': {
            const cid = intent.cardId as CardId | undefined;
            if (!cid) { st.log.push(`${name} hesitates.`); break; }

            // derive some harmless metadata for the log
            const spec: any = (CARD_SPECS as any)?.[String(cid)];
            const aoe = !!(spec?.params?.aoe);                  // enemies don't spend energy; just mark AOE
            const tgtTxt = intent.targetId ?? (aoe ? 'AOE' : undefined);

            // structured log of the enemy card play (energy=0→0 for enemies)
            log(st, {
                kind: 'card:play',
                who: enemy.id,
                cardId: cid,
                cardName: CARD_SPECS[cid]?.name,
                target: tgtTxt,
                energyBefore: 0,
                energyAfter: 0,
                aoe
            });

            playEnemyCard(st, enemy, cid, intent.targetId);
            break;
        }
        default:
            st.log.push(`${name} waits.`);
            break;
    }
    logStatusSnapshot(st, `after enemy intent ${enemy.name ?? enemy.id}`);
}

function decayStatusMap(map: StatusMap) {
    for (const [k, v] of Object.entries(map || {})) {
        if (!v) continue;
        const step = (typeof (v as any).decayPerTurn === 'number' ? (v as any).decayPerTurn : 1);
        if (typeof v.stacks === 'number') v.stacks = Math.max(0, v.stacks - step);
        if (typeof v.duration === 'number') v.duration = Math.max(0, v.duration - 1);

        // ✅ match status.ts: delete if stacks <= 0 OR (duration defined and <= 0)
        const stacksGone = (v.stacks != null) && (v.stacks <= 0);
        const durationGone = (typeof v.duration === 'number') && (v.duration <= 0);
        if (stacksGone || durationGone) {
            delete (map as any)[k];
        }
    }
}


export function endTurn(st: CombatState) {
    // --- Discard all remaining cards (no Retain yet in MVP)
    if (Array.isArray(st.hand) && st.hand.length) {
        for (const h of st.hand) st.discard.push(cardIdOf(h));
        st.hand = [] as any;
    }

    logStatusSnapshot(st, `pre-EOT DOT/decay`);
    // Burning damage ticks at end of turn (on both sides)
    const applyEndTurnDot = (who: 'player' | 'enemy' | string) => {
        let dmg = 0;
        let label = '';

        if (who === 'player' || who === 'enemy') {
            label = (who === 'player') ? 'Player' : (st.enemy?.name ?? 'Enemy');
            if (who === 'enemy' && (st.enemy?.hp ?? 0) <= 0) return;
            dmg = getEndTurnDamage(st as any, who);
        } else {
            const found = st.enemies.find(e => e.id === who);
            if (!found || (found.hp ?? 0) <= 0) return;
            const old = st.enemy;
            st.enemy = found;
            dmg = getEndTurnDamage(st as any, 'enemy');
            label = found.name ?? 'Enemy';
            st.enemy = old;
        }

        if (dmg > 0) {
            // Use synthetic source so logs read clearly
            const targetId =
                (who === 'player') ? 'player'
                    : (who === 'enemy') ? (st.enemy?.id ?? 'enemy')
                        : who; // concrete enemy id

            const res = dealDamage(st, 'status:Burning', targetId, dmg);
            st.log.push(`${label} suffers ${res.dealt} Burning.`);
        }

    };

    // DOT first
    for (const e of st.enemies) {
        if ((e.hp ?? 0) > 0) applyEndTurnDot(e.id);
    }
    applyEndTurnDot('player');
    decayStatusesPerTurn(st);
    logStatusSnapshot(st, `post-EOT DOT/decay`);

    // Start of enemy turn: clear enemies' Block and reset damage-taken tracker
    (st.player as any).turnDamageTaken = 0;
    for (const e of st.enemies) e.block = 0;

    // Enemies act
    for (const enemy of st.enemies.filter(e => (e.hp ?? 0) > 0)) {
        const name = enemy.name ?? 'Enemy';
        const cant = enemy.statuses?.['CantAct']?.stacks ?? 0;
        if (cant > 0) {
            enemy.statuses['CantAct'].stacks = cant - 1;
            st.log.push(`${name} cannot act.`);
            continue;
        }

        const intent = (enemy.intents && enemy.intents[0]) || rollEnemyIntent(st, enemy);
        applyEnemyIntent(st, enemy, intent);
    }

    // Roll intents for next turn
    for (const enemy of st.enemies.filter(e => (e.hp ?? 0) > 0)) {
        enemy.intents = [rollEnemyIntent(st, enemy)];
    }

    // Start of player's next turn
    st.player.block = 0;
    st.player.energy = st.player.energyMax;
    st.turn += 1;
    (st as any).__appliedOnce = new Map();
    log(st, { kind: 'turn:start', turn: st.turn });
    logStatusSnapshot(st, `Turn ${st.turn} start`);
    drawCards(st, st.player.drawPerTurn);
}

export function listStatuses(st: any, who: 'player' | 'enemy' | string) {
    if (who === 'player' || who === 'enemy') return listStatusesFromStatus(st, who);
    // If a specific enemy id is provided, temporarily alias st.enemy and reuse the status helper
    const found = st?.enemies?.find((e: any) => e?.id === who);
    if (found) {
        const clone = { ...st, enemy: found };
        return listStatusesFromStatus(clone, 'enemy');
    }
    return [];
}

// Optional: buffs/auras if you have them
export function listBuffs(st: any, who: 'player' | 'enemy' | string): Array<{ id: string; value?: number; duration?: number }> {
    const raw = st?.[who]?.buffs ?? st?.[who]?.modifiers ?? [];
    if (Array.isArray(raw)) return raw;
    return Object.entries(raw).map(([id, val]: any) => ({ id, ...(typeof val === 'object' ? val : { value: val }) }));
}

// Convenience accessor for UI expecting { draw, discard, hand, exhaust }
export function piles(st: CombatState) {
    return {
        draw: st.draw,
        discard: st.discard,
        hand: st.hand,
        exhaust: st.exhaust,
    };
}
// ===== Helpers: multi-enemy targeting & safety (append-only) =====
const MAX_ENEMIES = 3;

function enemyIdsAlive(st: CombatState): string[] {
    return (st.enemies || []).filter(e => (e?.hp ?? 0) > 0).map(e => e.id);
}

function firstAliveEnemyId(st: CombatState): string | undefined {
    return enemyIdsAlive(st)[0];
}

function allyIdsAlive(st: CombatState, actorId: string): string[] {
    // Player has no allies (yet)
    if (actorId === 'player') return [];
    return (st.enemies || [])
        .filter(e => e.id !== actorId && (e?.hp ?? 0) > 0)
        .map(e => e.id);
}

/**
 * Resolve param-driven targets for a card play.
 * - params.target: 'enemy' | 'self' | 'ally' | 'none' (default 'enemy')
 * - params.aoe: boolean (default false)
 * - clickedId: optional explicit user selection
 */
function resolveTargetsForCardPlay(
    st: CombatState,
    actorId: string, // 'player' or specific enemy id
    params: any,
    clickedId?: string
): string[] {
    const kind: 'enemy' | 'self' | 'ally' | 'none' = params?.target ?? 'enemy';
    const aoe: boolean = !!params?.aoe;
    const isPlayer = actorId === 'player';

    if (kind === 'self') return [actorId];
    if (kind === 'none') return [];

    if (kind === 'enemy') {
        if (isPlayer) {
            // PLAYER → enemies
            const alive = enemyIdsAlive(st);
            if (aoe) {
                if (alive.length) return alive;
                // last-ditch: fall back to compat alias
                return st.enemy?.id ? [st.enemy.id] : ['enemy'];
            }
            const pick =
                (clickedId && alive.includes(clickedId)) ? clickedId :
                    (alive[0] ?? (st.enemy?.id ?? 'enemy'));
            return [pick];
        } else {
            // ENEMY → opposing side (the player)
            return ['player'];
        }
    }

    if (kind === 'ally') {
        // Player has no allies (yet)
        if (isPlayer) return [];
        const allies = allyIdsAlive(st, actorId);
        if (aoe) return allies;
        if (clickedId && allies.includes(clickedId)) return [clickedId];
        return allies.length ? [allies[0]] : [];
    }

    return [];
}

// Safety: clamp enemies length (call this in init after populating)
function clampEnemies(st: CombatState) {
    if (st.enemies.length > MAX_ENEMIES) {
        st.enemies = st.enemies.slice(0, MAX_ENEMIES);
    }
}

