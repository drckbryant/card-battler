// cli.ts
import { buildStarterDeck } from "./deck";

// Read argv only if we're actually in Node, without importing Node types
const argv = ((globalThis as any)?.process?.argv as string[] | undefined);
const who = ((argv && argv[2]) ? argv[2] : "Ren") as any;

const seedArg = argv && argv[3] ? Number(argv[3]) : undefined;
const deck = buildStarterDeck(who, { seed: seedArg });

function main() {
  const deck = buildStarterDeck(who);
  console.log(`Starter deck for ${who}:`);
  const tally = deck.reduce<Record<string, number>>((m, c) => {
    m[c.name] = (m[c.name] ?? 0) + 1;
    return m;
  }, {});
  for (const [name, count] of Object.entries(tally) as [string, number][]) {
    console.log(`- ${name} x${count}`);
  }
}

try {
  main();
} catch (e) {
  console.error(String(e));
  // Exit with non-zero code *only if* we're in Node
  const proc = (globalThis as any)?.process;
  if (proc?.exit) proc.exit(1);
}
