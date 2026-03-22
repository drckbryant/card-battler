import type { CharacterKey } from '../content/characters';

export type TagKey = string;
export type StatusKey = 'Burning' | 'Weak' | 'Exposed' | string;

export const CORE_INFERRED_PARAMS = ['damage', 'block', 'draw'] as const;
export type CoreInferredParam = typeof CORE_INFERRED_PARAMS[number];

export type Form = 'Ash' | 'Ember';

export type RelicKey =
    | 'Black Cauldron'
    | 'Moon Devourer'
    | 'Burning Blood'
    | 'Cursed Bones'
    | string;

export interface Relic {
    key: RelicKey;
    name: string;
    text: string;
    // Optional lifecycle hooks. Add more later.
    onCombatStart?: (ctx: Ctx, actorId: string) => void;
    onFormChange?: (ctx: Ctx, actorId: string, from: Form, to: Form) => void;
}

export type EffectKey =
    | 'empower'
    | 'hitsPerTag'
    | 'gainEnergy'
    | 'detonation'
    | 'ashScales'
    | 'changeAsh'
    | 'changeEmber'
    | 'eviscerate'
    | 'difference'
    | 'requireStatus'
    | 'addCardToHand'
    | 'addEachTurn'
    | 'weak'
    | 'exposed'
    | 'CantAct'
    | string;

export type Plus = {
    tag: TagKey;
    amount?: number;
};

export type Requires = {
    tag?: TagKey;
    amount?: number;
    consume?: boolean | 'all';
    status?: StatusKey;
};

export type IfForm = {
    aoe?: boolean;
    burning?: number;
    extraHits?: number;
    extraDamage?: number;
};

export type CardParams = {
    [k: string]: any;
    // common knobs
    tag?: TagKey;
    damage?: number;
    block?: number;
    hits?: number;
    energy?: number;
    factor?: number;
    selfHpLoss?: number;
    duration?: number;
    reduceIncoming?: number;
    weak?: number;
    exposed?: number;
    // composition
    plus?: Plus;
    requires?: Requires;
    ifAsh?: IfForm;
    ifEmber?: IfForm;
    // card generation / references
    cardId?: string;
    count?: number;
    // targeting / dynamic sources
    aoe?: boolean;
    source?: string;
};

export type CardSpec = {
    name: string;
    type: 'Attack' | 'Skill' | 'Alteration' | 'Affliction' | string;
    cost: number;
    effect?: EffectKey[];
    text: string;
    params?: CardParams;
    keywords?: string[];
    rarity?: 'Common' | 'Uncommon' | 'Rare';
    owners?: CharacterKey[];
    pools?: Array<'Neutral' | 'Starter' | 'Reward'>;
    tags?: string[];
    maxCopies?: number;
    starterCopies?: number;
    cid?: number;
};

export type CardSpecs = Record<string, CardSpec>;

export type EffectSpec = {
    required: string[];
    optional?: string[];
};

export type EffectsRegistry = Record<EffectKey, EffectSpec>;

export type DisplayFields = {
    tagLabel?: string;
    targets?: string;
    factorLabel?: string;
    burningText?: string;
    weakText?: string;
    exposedText?: string;
    plus?: { tagLabel?: string; amount?: number };
    requires?: { tagLabel?: string; statusLabel?: string };
    ifEmber?: { targets?: string; burningText?: string };
};

export type RenderExtra = {
    stat?: Record<string, number | string>;
    cardNameMap?: Record<string, string>;
};

export type RenderDict = CardParams & DisplayFields & RenderExtra;

export type Renderer = {
    deriveDisplay: (p: CardParams) => DisplayFields;
    render: (tpl: string, params: CardParams, extra?: RenderExtra) => string;
};

export type DeriveEffects = (c: CardSpec) => EffectKey[];

// ==============================
// Phase 0: Multi-enemy scaffolding
// ==============================
export type EnemyId = string;
export type IntentKind = 'attack' | 'defend' | 'buff' | 'debuff' | 'idle';

export interface Intent {
    kind: IntentKind;
    value?: number;           // preview (damage, block, etc.)
    hits?: number;            // for multi-hit previews
    status?: { key: StatusKey; stacks: number };
    target?: 'player' | 'self' | 'ally' | 'randomEnemy';
}

export interface Enemy {
    id: EnemyId;
    name: string;
    hp: number;
    maxHp: number;
    block: number;
    statuses: Record<string, { stacks: number; [k: string]: any }>;
    intents: Intent[]; // shown during player's turn
    // Optional: simple AI you can attach later
    ai?: (st: any, self: Enemy) => Intent[];
}

// ===== Phase 1: Targeting & Actor types (append-only patch) =====
// Minimal, non-breaking additions to support enemy AI and support-type skills.

// 1) Side + ActorRef (compatible with your existing EnemyId)
export type Side = 'Player' | 'Enemy';
export type ActorRef = { side: 'Player' } | { side: 'Enemy'; id: EnemyId };

// 2) Target kinds for card params
export type TargetKind = 'enemy' | 'self' | 'ally' | 'none';

// 3) Extend CardParams with optional target selector (keeps your default behavior intact)
declare module './types' {}

// Since we're appending inside the same file, we can safely augment the existing CardParams via declaration merging-like pattern.
// If your setup doesn't allow interface merging across modules, simply add this field to CardParams directly:
//   target?: TargetKind;
// For convenience, we redeclare the field here so downstream code can rely on it.
export interface CardParams {
  /** Optional targeting hint for effects/AI. Defaults to 'enemy' if omitted. */
  target?: TargetKind;
}

// Notes:
// - ActorRef uses EnemyId so you don't have to switch to index-based enemies.
// - 'ally' refers to another enemy when the source is an enemy; for the player side, it can be ignored until allies/summons exist.

