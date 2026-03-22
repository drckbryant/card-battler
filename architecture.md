# Card Battler Architecture

_Last updated: 2025-09-25_

## Files & Roles

- **card_specs.ts** — Declarative card data only (name, type, cost, params, effect keys, text, tags/keywords, rarity, owners, pools, flags). Params may include conditional blocks like `ifEmber`/`ifAsh`. **No logic.**

- **characters.ts** — Declarative character data (hpMax, energyMax, drawPerTurn, starting relic if used, associations to cards for deckbuilding). **No logic.**

- **deck.ts** — Deckbuilding & pile utilities (starter deck build, shuffles, draws/reshuffles). **No gameplay rules.**

- **rng.ts** — Seeded RNG helpers used by deck and any deterministic systems.

- **types.ts** — Shared engine types only (CardId, CharacterKey, StatusKey enums, etc.). **No behavior.**

- **combat.ts** — Orchestrator of the turn loop and piles.
  - Init `CombatState`; manage draw/hand/discard/exhaust; handle End Turn flow.
  - Route keyword flags (**Exhaust / End Turn / Retain**) and pile movement.
  - Call **effects** for verbs; **status** for gating/decay/ticks and damage math; **forms** to read/change forms.
  - **No card-specific branching.**

- **effects.ts** — Effect registry: `effectKey → behavior`.
  - Generic verbs only (`dealAttack`, `gainBlock`, `applyStatus`, `draw`, `scry`, etc.).
  - Interprets param-driven conditional gates (e.g., `ifEmber` / `ifAsh`) and calls `status/forms`.
  - **No lifecycle rules/ticks/multipliers here. No card names.**

- **status.ts** — Centralized status system with lifecycle & hooks.
  - `add/remove/merge`, `decayPerTurn`, `list` for UI.
  - Hooks: `getOutgoingMultiplier` (Weak), `getIncomingMultiplier` (Exposed), `canPlayChecker` (CantAct), `onEndTurnTick` (Burning/Poison), `onBeforeHit` (Scales/Thorns).
  - Param-driven applier (e.g., `burning/weak/exposed/cantAct`). **No card names.**

- **forms.ts** — Source of truth for forms.
  - `getForm` / `changeForm` (+ optional `canChangeForm`, `onEnter`, `onExit` hooks).
  - Enforce form invariants. **No card logic.**

- **damage.ts** _(optional)_ — Single damage pipeline function calling status hooks, applying block, returning a breakdown. Centralizes math.

- **helpers.ts** — Render-only helpers for UI text templating. **No rules or state mutation.**

- **validate.ts / devcheck.ts** — Dev-time checks (e.g., every effect key in specs exists in EFFECTS; keywords normalized; spec flags sanity). **No runtime behavior.**

- **combat.cli.ts / cli.ts** — Local testing harnesses / dev wrappers. **No engine rules.**

- **relics.ts** — Declarative relic definitions (name, rarity, text, params, tags). **No engine logic.**
  - Relic behavior should be expressed via:
    - adding statuses (through `effects.applyStatus` / `status.add`) at start-of-combat or on triggers, or
    - emitting generic effect verbs (e.g., `onStart`, `onDraw`, `onPlay` hooks resolved by the engine calling into **effects**).
  - `combat.initCombat` may read starting relics from `characters.ts` and call generic verbs; lifecycle/ticks still live in **status.ts**, not here.

## Guiding Principles
- **No card-name conditionals** in the engine; behavior is driven by effect keys + params (incl. `ifEmber`/`ifAsh` blocks).
- **Keyword flags** (End Turn / Exhaust / Retain) enforced by **combat** from specs/tags/text (normalization OK)—not via effects.
- **Statuses** are lifecycle-based and live in **status.ts**; **effects.ts** only triggers them.
- **Forms** are state; **effects** are events. Keep them split.
- Keep modules **pure and testable**.

