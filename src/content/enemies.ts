import { CARD_SPECS } from './card_specs';

export type CardKey = keyof typeof CARD_SPECS;
export type EnemyAIKey = 'BasicAggro' | 'CasterTempo' | 'Supportive' | 'BossPhase1' | 'BossPhase2';
export type EnemyTier = 'Normal' | 'Elite' | 'Boss';

export interface EnemySpec {
    key: EnemyKey;
    name: string;
    tier?: EnemyTier;
    hpMax: number;
    tags?: string[];           // e.g. ['Melee'], ['Mage'], ['Support']
    deck: CardKey[];           // uses card ids from CARD_SPECS (we'll add Enemy* cards there)
    ai: EnemyAIKey;            // selection behavior policy
    baseDamage?: number;       // optional default damage for simple intents
    modifiers?: {              // used to scale Elites/Bosses without new rules
        hpMult?: number;         // e.g. 1.4 for elites
        dmgMult?: number;        // e.g. 1.2 for elites
        extraCards?: CardKey[];  // added to deck at instantiation
    };
}

export type EnemyKey =
    | 'Goblin' // melee type
    | 'Kobold' // mage type
    | 'Mandragora' // support type
    | 'Hobgoblin' // Elite melee type
    | 'GoblinKing';

// --- Base roster ---
export const Goblin: EnemySpec = {
    key: 'Goblin',
    name: 'Goblin',
    tier: 'Normal',
    hpMax: 34,
    tags: ['Melee'],
    deck: ['EnemyStrike', 'EnemyBlock'],
    ai: 'BasicAggro',
    baseDamage: 5,
};

export const Kobold: EnemySpec = {
    key: 'Kobold',
    name: 'Kobold',
    tier: 'Normal',
    hpMax: 28,
    tags: ['Mage'],
    deck: ['EnemyEmpower', 'EnemyBurn', 'EnemyZap'],
    ai: 'CasterTempo',
    baseDamage: 4,
};

export const Mandragora: EnemySpec = {
    key: 'Mandragora',
    name: 'Mandragora',
    tier: 'Normal',
    hpMax: 30,
    tags: ['Support'],
    // Mandragora now focuses on protecting allies instead of exposing the player
    deck: ['EnemyAllyEmpower', 'EnemyMinorHeal', 'EnemyAllyBlock'],
    ai: 'Supportive',
};

// --- Elite example (same enemy with declarative multipliers) ---
export const Hobgoblin: EnemySpec = {
    key: 'Hobgoblin',
    name: 'Hobgoblin (Elite)',
    tier: 'Elite',
    hpMax: 34,
    tags: ['Melee', 'Elite'],
    deck: ['EnemyExpose', 'EnemyStrike', 'EnemyBlock'],
    ai: 'BasicAggro',
    baseDamage: 6,
    modifiers: { hpMult: 1.45, dmgMult: 1.2 },
};

// --- Boss example with two-phase AI (AI swap handled in enemy_ai.ts) ---
export const GoblinKing: EnemySpec = {
    key: 'GoblinKing',
    name: 'Goblin King',
    tier: 'Boss',
    hpMax: 120,
    tags: ['Boss', 'Melee'],
    deck: ['EnemyExpose', 'EnemyStrike', 'EnemyBlock'],
    ai: 'BossPhase1',
    baseDamage: 7,
    modifiers: { hpMult: 1.0, dmgMult: 1.0, extraCards: [] },
};

export const ENEMIES: Record<EnemyKey, EnemySpec> = {
    Goblin,
    Kobold,
    Mandragora,
    Hobgoblin,
    GoblinKing,
};

// --- Encounters (pick 1..3 specs by key) ---
export type Encounter = EnemyKey[];
