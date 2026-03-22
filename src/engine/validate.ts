// validate.ts
import { CARD_SPECS, type CardId } from "../content/card_specs";
import { CHARACTERS, type CharacterKey } from "../content/characters";

type AnyCardSpec = (typeof CARD_SPECS)[keyof typeof CARD_SPECS];
type AnyCharacter = (typeof CHARACTERS)[keyof typeof CHARACTERS];
type Pool = "Neutral" | "Starter" | "Reward";

const knownCards = new Set(Object.keys(CARD_SPECS) as CardId[]);
const knownChars = new Set(Object.keys(CHARACTERS) as CharacterKey[]);
const knownPools = new Set<Pool>(["Neutral", "Starter", "Reward"]);

const errs: string[] = [];

// Card checks
for (const [id, raw] of Object.entries(CARD_SPECS) as [CardId, AnyCardSpec][]) {
  const owners = (raw.owners ?? []) as readonly CharacterKey[];
  const pools = (raw.pools ?? []) as readonly Pool[];

  for (const o of owners) {
    if (!knownChars.has(o)) errs.push(`Card ${id} has unknown owner "${o}"`);
  }
  for (const p of pools) {
    if (!knownPools.has(p)) errs.push(`Card ${id} has unknown pool "${p}"`);
  }

  // keyword/text sync example (optional, safe for missing 'keywords')
  const saysRetain = /(^|\W)retain(\W|$)/i.test(raw.text ?? "");
  const kws: readonly string[] =
    typeof (raw as any).keywords !== "undefined" && Array.isArray((raw as any).keywords)
      ? ((raw as any).keywords as readonly string[])
      : [];
  const hasRetainKw = kws.includes("Retain");
  if (saysRetain && !hasRetainKw) {
    errs.push(`Card ${id} mentions "Retain" but keywords lack 'Retain'`);
  }
}

// Character checks
for (const [ckey, c] of Object.entries(CHARACTERS) as [CharacterKey, AnyCharacter][]) {
  const starter = c.starter as {
    strikes: number;
    guards: number;
    randomUnique: number;
    signatureCards?: CardId[];
  };

  for (const sc of starter.signatureCards ?? []) {
    if (!knownCards.has(sc)) errs.push(`Character ${ckey} signatureCards references unknown card "${sc}"`);
  }

  const sigs = (starter.signatureCards ?? []) as readonly string[];
  for (const sc of sigs) {
    if (!knownCards.has(sc as CardId)) {
      errs.push(`Character ${ckey} signatureCards references unknown card "${sc}"`);
    } else {
      const spec = CARD_SPECS[sc as CardId] as AnyCardSpec;
      const owners = (spec.owners ?? []) as readonly CharacterKey[];
      if (!owners.includes(ckey)) {
        errs.push(`Character ${ckey} signature card "${sc}" is not owned by ${ckey}`);
      }
    }
  }

  const availableStarter = (Object.keys(CARD_SPECS) as CardId[]).filter(id => {
    const s = CARD_SPECS[id] as AnyCardSpec;
    const owners = (s.owners ?? []) as readonly CharacterKey[];
    const pools = (s.pools ?? []) as readonly Pool[];
    return owners.includes(ckey) && pools.includes("Starter");
  });
  const sigCount = (starter.signatureCards ?? []).length;
  const need = Math.max(0, starter.randomUnique - sigCount);
  if (availableStarter.length < need) {
    errs.push(`Character ${ckey}: needs ${need} Starter uniques but only ${availableStarter.length} exist: [${availableStarter.join(", ")}].`);
  }


  if (starter.strikes < 0 || starter.guards < 0 || starter.randomUnique < 0) {
    errs.push(`Character ${ckey} has negative starter counts`);
  }
}

if (errs.length) {
  const msg = `❌ Validation failed:\n- ${errs.join("\n- ")}`;
  // Avoid Node typings; throwing works in ts-node/tsx/web bundlers alike
  throw new Error(msg);
} else {
  // eslint-disable-next-line no-console
  console.log("✅ Validation passed.");
}