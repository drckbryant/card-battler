import { CARD_SPECS, type CardId } from "../content/card_specs";
import { CHARACTERS } from "../content/characters";
import type { CharacterKey } from "../content/characters"; // or wherever CharacterKey comes from
import { pickN } from "./rng";

export type BuildOptions = {
    /** Seed for deterministic picks */
    seed?: number;
    /** Hard cap for total deck size (defaults to 10) */
    maxDeckSize?: number;
    /** Future switch; keep "none" by default to stay Starter-only */
    fallback?: "none" | "rewardCommon" | "dupeStarter";
};

const DEFAULT_BUILD_OPTIONS: Required<Pick<BuildOptions, "seed" | "maxDeckSize" | "fallback">> = {
    seed: 777,
    maxDeckSize: 10,
    fallback: "none",
};

type AnyCardSpec = (typeof CARD_SPECS)[keyof typeof CARD_SPECS];
type AnyCharacter = (typeof CHARACTERS)[keyof typeof CHARACTERS];
export type DeckEntry = { id: CardId; name: string };

function pickStarterCandidatesFor(character: CharacterKey): CardId[] {
    const ids = Object.keys(CARD_SPECS) as CardId[];
    return ids.filter((id) => {
        const spec = CARD_SPECS[id] as AnyCardSpec;
        const owners = (spec.owners ?? []) as readonly CharacterKey[];
        const pools = (spec.pools ?? []) as readonly ("Neutral" | "Starter" | "Reward")[];
        return owners.includes(character) && pools.includes("Starter");
    });
}

export function buildStarterDeck(character: CharacterKey, opts: BuildOptions = {}): DeckEntry[] {
    const { seed, maxDeckSize } = { ...DEFAULT_BUILD_OPTIONS, ...opts };

    const c = CHARACTERS[character] as AnyCharacter;
    const starter = c.starter as {
        strikes: number;
        guards: number;
        randomUnique: number;
        signatureCards?: readonly string[]; // loose here on purpose
    };

    const deck: DeckEntry[] = [];

    // 1) Core strikes/guards
    for (let i = 0; i < starter.strikes; i++) {
        deck.push({ id: "Strike", name: (CARD_SPECS["Strike"] as AnyCardSpec).name });
    }
    for (let i = 0; i < starter.guards; i++) {
        deck.push({ id: "Guard", name: (CARD_SPECS["Guard"] as AnyCardSpec).name });
    }

    // Initialize counts AFTER basics so signatures/uniques respect maxCopies
    const seenCounts = new Map<CardId, number>();
    for (const entry of deck) {
        seenCounts.set(entry.id, (seenCounts.get(entry.id) ?? 0) + 1);
    }

    // 2) Signature cards (occupy randomUnique slots)
    const sigNames = (starter.signatureCards ?? []) as readonly string[];
    let sigAdded = 0;

    for (const ref of sigNames) {

        const id = ref as CardId; // assumes you used the card ID (e.g., "AshenScale")
        const spec = CARD_SPECS[id] as AnyCardSpec | undefined;
        if (!spec) throw new Error(`signatureCards references unknown card: "${ref}"`);

        const max = spec.maxCopies ?? Infinity;
        const have = seenCounts.get(id) ?? 0;
        if (have + 1 > max) continue;

        deck.push({ id, name: spec.name });
        seenCounts.set(id, have + 1);
        sigAdded++;
    }

    // 3) Fill remaining with unique Starter cards

    const base = starter.strikes + starter.guards;
    const allowedRandom = Math.max(0, Math.min(starter.randomUnique, maxDeckSize - base));
    const need = Math.max(0, allowedRandom - sigAdded);

    const pool = pickStarterCandidatesFor(character);
    const already = new Set(deck.map((d) => d.id));       // now includes signatures
    const uniquePool = pool.filter((id) => !already.has(id));

    for (const id of pickN(uniquePool, need, seed)) {
        const spec = CARD_SPECS[id] as AnyCardSpec;
        const max = spec.maxCopies ?? Infinity;
        const have = seenCounts.get(id) ?? 0;
        if (have + 1 > max) continue;
        deck.push({ id, name: spec.name });
        seenCounts.set(id, have + 1);
    }

    return deck;
}
