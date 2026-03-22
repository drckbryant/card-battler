// encounters.ts — pure helpers for building combat encounters
// Keeps content logic separate from per-turn AI and the engine runtime.
// Adjust the import path below to wherever your content lives.

import { ENEMIES, type EnemyKey, type EnemySpec } from '../content/enemies';

// Public shape for an encounter: a list of enemy keys (1..3 recommended)
export type Encounter = EnemyKey[];

// Identifier type for named encounters (optional, but nice for autocomplete)
export type EncounterId =
  | 'duo_goblin_kobold'
  | 'trio_goblin_goblin_mandragora'
  | 'trio_goblin_kobold_mandragora'
  | 'elite_room'
  | 'boss_room';

// Central registry of named encounters
export const ENCOUNTERS: Record<EncounterId, Encounter> = {
  duo_goblin_kobold: ['Goblin', 'Kobold'],
  trio_goblin_goblin_mandragora: ['Goblin', 'Goblin', 'Mandragora'],
  trio_goblin_kobold_mandragora: ['Goblin', 'Kobold', 'Mandragora'],
  elite_room: ['Hobgoblin'],
  boss_room: ['GoblinKing'],
};

/**
 * Apply hp/card modifiers and return a new spec object (immutably).
 * This keeps ENEMIES immutable and safe to share.
 */
export function materializeSpec(spec: EnemySpec): EnemySpec {
  const hpMult = spec.modifiers?.hpMult ?? 1;
  const extra = spec.modifiers?.extraCards ?? [];
  return {
    ...spec,
    hpMax: Math.max(1, Math.round(spec.hpMax * hpMult)),
    deck: [...spec.deck, ...extra],
  };
}

/** Build a concrete encounter (array of EnemySpec) from a list of keys. */
export function buildEncounter(keys: Encounter): EnemySpec[] {
  return keys.map(k => materializeSpec(ENEMIES[k]));
}

/** Fetch by id with a safe default. */
export function getEncounterById(id: EncounterId = 'duo_goblin_kobold'): EnemySpec[] {
  const keys = ENCOUNTERS[id] ?? ENCOUNTERS.duo_goblin_kobold;
  return buildEncounter(keys);
}

/** Utility: cap any encounter to N enemies (engine usually supports up to 3). */
export function clampEncounter(keys: Encounter, max = 3): Encounter {
  return keys.slice(0, Math.max(0, max));
}

/**
 * Optional dev check: verify that every card id referenced by enemy decks
 * exists in the provided CARD_SPECS map. Engine-agnostic and pure.
 */
export function validateEnemyDecks(
  availableCards: Record<string, unknown>,
  specs: Record<string, EnemySpec> = ENEMIES as Record<string, EnemySpec>
): string[] {
  const issues: string[] = [];
  const checkCard = (cid: string, owner: string) => {
    if (!availableCards || !(cid in availableCards)) issues.push(`${owner} deck references missing card: ${cid}`);
  };
  for (const [key, spec] of Object.entries(specs)) spec.deck.forEach(cid => checkCard(cid, key));
  return issues;
}
