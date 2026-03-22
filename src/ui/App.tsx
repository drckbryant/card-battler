import { useEffect, useMemo, useState } from 'react';
import { CARD_SPECS, type CardId } from '../content/card_specs';
import { CHARACTERS } from '../content/characters';
import { initCombat, playCard as playCardEngine, endTurn as endTurnEngine, type CombatState, getForm, listStatuses, piles } from '../engine/combat';
import { renderCardText } from '../engine/helpers'; // adjust path if needed
import { statusLabel } from '../engine/helpers';
import { factorLabel } from '../engine/helpers';

function get(obj: any, path: string) {
    return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

// Normalize anything (id string or object) to a spec id key.
function normalizeCardId(x: any): string {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object') {
        return (x.id ?? x.cardId ?? x.cid ?? x.key ?? String(x));
    }
    return String(x);
}

type CharacterKey = keyof typeof CHARACTERS;

function useCombat(startChar: CharacterKey = 'Winnifred', seed = 12345) {
    const [state, setState] = useState<CombatState>(() => initCombat(startChar, { seed }));

    const api = useMemo(() => ({
        reset(char: CharacterKey = startChar, newSeed?: number) {
            setState(initCombat(char, { seed: newSeed ?? seed }));
        },
        play(handIndex: number) {
            setState(prev => {
                const next: CombatState = structuredClone(prev);
                const ok = playCardEngine(next, handIndex);
                if (!ok) (next as any).log?.push?.('Cannot play that card.');
                return next;
            });
        },
        playTargeted(handIndex: number, targetId: string) {
            setState(prev => {
                const next: CombatState = structuredClone(prev);
                const ok = (playCardEngine as any)(next, handIndex, targetId);
                if (!ok) (next as any).log?.push?.('Cannot play that card.');
                return next;
            });
        },
        endTurn() {
            setState(prev => {
                const next: CombatState = structuredClone(prev);
                endTurnEngine(next);
                return next;
            });
        },
    }), [seed, startChar]);

    return { state, ...api };
}

// Simple intent chip for enemies
function IntentChip({ intent }: { intent: any }) {
    if (!intent) return null;
    switch (intent.kind) {
        case 'attack':
            return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs">🗡️ Attack {intent.value ?? 0}</span>;
        case 'defend':
            return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-xs">🛡️ Defend {intent.value ?? 0}</span>;
        case 'debuff':
            return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs">☠️ {intent.status?.key} +{intent.status?.stacks ?? 0}</span>;
        default:
            return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border px-2 py-0.5 text-xs">…</span>;
    }
}

function CardTile({ id, onPlay, st }: { id: any; onPlay?: () => void; st?: CombatState }) {
    const cardId = normalizeCardId(id);
    const spec: any = (CARD_SPECS as any)[cardId];
    const name = spec?.name ?? String(cardId);
    const cost = spec?.cost ?? 0;
    const type = spec?.type ?? '';
    const keywords: string[] = Array.isArray(spec?.keywords) ? spec.keywords : [];

    const clickable = Boolean(onPlay);

    // Build minimal extras so tokens like {requires.statusLabel} resolve
    const extra: any = {};
    const req = spec?.params?.requires;
    if (req?.status) {
        extra.requires = { statusLabel: statusLabel(req.status) };
    }

    const text = renderCardText(spec, extra, st) || String(spec?.text ?? '');

    return (
        <button
            className={`flex flex-col gap-1 rounded-2xl border p-3 w-44 text-left bg-white ${clickable ? 'hover:shadow transition' : 'opacity-60 cursor-not-allowed'
                }`}
            onClick={onPlay}
        >
            <div className="flex items-center justify-between">
                <div className="font-semibold">{name}</div>
                <div className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-sm">⚡ {cost}</div>
            </div>
            <div className="text-xs text-slate-500">{type}</div>
            {keywords.length > 0 && (
                <div className="mt-1 text-xs text-slate-600">[{keywords.join(', ')}]</div>
            )}
            <div className="text-sm whitespace-pre-line">{text}</div>
        </button>
    );
}

function StatusChips({ items }: { items: Array<{ id: string; stacks?: number; duration?: number }> }) {
    if (!items || items.length === 0) return <span className="text-slate-400">None</span>;
    return (
        <div className="flex flex-wrap gap-2">
            {items.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-white">
                    <span className="font-medium">{statusLabel?.(s.id) ?? s.id}</span>
                    {s.stacks != null && <span>×{s.stacks}</span>}
                </span>
            ))}
        </div>
    );
}

function BuffChips({ items }: { items: Array<{ id: string; value?: number; duration?: number }> }) {
    if (!items || items.length === 0) return <span className="text-slate-400">None</span>;
    return (
        <div className="flex flex-wrap gap-2">
            {items.map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-amber-50 border-amber-200">
                    <span className="font-medium">{b.id}</span>
                    {b.value != null && (b.id.startsWith('Empower') || b.id.startsWith('Plus')) && <span>+{b.value}</span>}
                </span>
            ))}
        </div>
    );
}

// Build UI-friendly buff chips: Empower +N and Multi: Label
function buildBuffChips(state: any, who: 'player' | 'enemy'): Array<{ id: string; value?: number; duration?: number }> {
    const actor = state?.[who] ?? {};
    const buffs = actor.buffs ?? {};
    const out: Array<{ id: string; value?: number; duration?: number }> = [];

    // Combine Empower + Plus for Iron Summoning
    const add = (buffs?.Empower?.IronSummoning ?? 0) + (buffs?.Empower?.['Iron Summoning'] ?? 0)
        + (buffs?.plus?.IronSummoning ?? 0) + (buffs?.plus?.['Iron Summoning'] ?? 0);
    if (add > 0) out.push({ id: 'Empower', value: add });

    // Multi with readable label
    const f = buffs?.multi?.IronSummoning ?? buffs?.multi?.['Iron Summoning'];
    if (typeof f === 'number' && f !== 1) {
        out.push({ id: `Multi: ${factorLabel(f)}` });
    }

    // Include any other simple numeric buffs (fallback), excluding ones we already represented
    const skipParents = new Set(['Empower', 'plus', 'multi']);
    for (const parent of Object.keys(buffs)) {
        if (skipParents.has(parent)) continue;
        const obj = buffs[parent];
        if (obj && typeof obj === 'object') {
            for (const [k, v] of Object.entries(obj)) {
                if (typeof v === 'number' && v !== 0) {
                    const label = `${parent[0].toUpperCase()}${parent.slice(1)} (${k})`;
                    out.push({ id: label, value: v as number });
                }
            }
        }
    }
    return out;
}

function PileView({ title, ids }: { title: string; ids: CardId[] }) {
    const count = ids?.length ?? 0;
    const preview = (ids ?? []).slice(0, 5);
    return (
        <div className="rounded-2xl bg-white border p-3">
            <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">{title}</div>
                <div className="text-xs text-slate-500">{count}</div>
            </div>
            <div className="flex gap-2 flex-wrap">
                {preview.map((id, i) => {
                    const cardId = normalizeCardId(id);
                    const spec: any = (CARD_SPECS as any)[cardId];
                    return (
                        <div key={`${normalizeCardId(id)}-${i}`} className="px-2 py-1 text-xs rounded-md border bg-slate-50">
                            {String(spec?.name ?? String(cardId))}
                        </div>
                    );
                })}
                {count === 0 && <div className="text-xs text-slate-400">Empty</div>}
            </div>
        </div>
    );
}

export default function App() {
    const [char, setChar] = useState<CharacterKey>('Winnifred');
    const [seed, setSeed] = useState<number>(12345);
    const { state, reset, play, playTargeted, endTurn: endTurnApi } = useCombat(char, seed);
    const ps = piles(state as any);

    // Targeting state: which card index is awaiting an enemy click
    const [pendingIdx, setPendingIdx] = useState<number | null>(null);

    const playerDead = (state as any).player?.hp <= 0;
    const allEnemies = (state as any).enemies ?? ((state as any).enemy ? [(state as any).enemy] : []);
    const enemiesAlive = allEnemies.filter((e: any) => (e?.hp ?? 0) > 0);
    const someoneDead = enemiesAlive.length === 0;

    useEffect(() => {
        if (playerDead) console.log('You died!');
        if (someoneDead) console.log('All enemies defeated!');
    }, [playerDead, someoneDead]);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
                <header className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Card Battler — Prototype</h1>
                    <div className="flex items-center gap-2">
                        <select
                            className="border rounded-md px-2 py-1 bg-white"
                            value={char}
                            onChange={(e) => setChar(e.target.value as CharacterKey)}
                        >
                            {Object.keys(CHARACTERS).map(k => (
                                <option key={k} value={k}>{k}</option>
                            ))}
                        </select>
                        <input
                            className="border rounded-md px-2 py-1 w-28"
                            type="number"
                            value={seed}
                            onChange={(e) => setSeed(parseInt(e.target.value || '0', 10))}
                        />
                        <button className="rounded-md bg-slate-900 text-white px-3 py-1" onClick={() => reset(char, seed)}>
                            New Combat
                        </button>
                    </div>
                </header>

                <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl bg-white border p-4">
                        <div className="text-lg font-semibold">Player</div>
                        <div className="text-sm">HP: {Number((state as any).player?.hp ?? 0)}</div>
                        <div className="text-sm">Block: {Number((state as any).player?.block ?? 0)}</div>
                        <div className="text-sm">Energy: {Number((state as any).player?.energy ?? 0)}/{Number((state as any).player?.energyMax ?? 0)}</div>
                        <div className="text-sm">Turn: {Number((state as any).turn ?? 0)}</div>
                        <div className="mt-2 text-sm">Form: {getForm(state as any, 'player') ?? '—'}</div>
                        <div className="mt-2 text-sm">Status:</div>
                        <StatusChips items={listStatuses(state as any, 'player')} />
                        <div className="mt-2 text-sm">Buffs:</div>
                        <BuffChips items={buildBuffChips(state as any, 'player')} />
                    </div>

                    <div className="rounded-2xl bg-white border p-4">
                        <div className="text-lg font-semibold mb-2">Enemies</div>
                        <div className="grid grid-cols-1 gap-2">
                            {allEnemies.map((e: any, idx: number) => (
                                <button
                                    key={e.id || idx}
                                    className={`w-full text-left rounded-xl border p-3 bg-white`}
                                    onClick={() => {
                                        if (pendingIdx != null) {
                                            playTargeted(pendingIdx, (e as any).id);
                                            setPendingIdx(null);
                                        }
                                    }}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="font-semibold">{String((e as any)?.name ?? 'Enemy')}{` #${idx + 1}`}</div>
                                        <div className="flex items-center justify-between">
                                            <div>intends to use <IntentChip intent={(e as any)?.intents?.[0]} /></div>
                                        </div>

                                    </div>
                                    <div className="text-sm">HP: {Number((e as any)?.hp ?? 0)}</div>
                                    <div className="text-sm">Block: {Number((e as any)?.block ?? 0)}</div>
                                    <div className="mt-2 text-sm">Status:</div>
                                    <StatusChips items={listStatuses(state as any, (e as any).id)} />
                                </button>
                            ))}
                            {allEnemies.length === 0 && <div className="text-sm text-slate-500">No enemies.</div>}
                        </div>
                    </div>

                    <div className="rounded-2xl bg-white border p-4">
                        <div className="grid grid-cols-3 gap-3">
                            <PileView title="Draw" ids={ps.draw} />
                            <PileView title="Discard" ids={ps.discard} />
                            <PileView title="Exhaust" ids={ps.exhaust} />
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                className="rounded-md bg-indigo-600 text-white px-3 py-2 disabled:opacity-50"
                                onClick={() => endTurnApi()}
                                disabled={playerDead || someoneDead} >
                                End Turn
                            </button>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl bg-white border p-4">
                    <div className="mb-2 font-semibold">Hand</div>
                    <div className="flex flex-wrap gap-3">
                        {(state as any).hand?.map((id: any, idx: number) => {
                            const cardId = normalizeCardId(id);
                            const spec: any = (CARD_SPECS as any)[cardId];
                            const disabled = playerDead || someoneDead;
                            const isAoe = !!spec?.params?.aoe;
                            const targetParam = spec?.params?.target ?? (spec?.type === 'Attack' ? 'enemy' : 'none');
                            const wantsTarget = !isAoe && targetParam === 'enemy';
                            return (
                                <div key={`${id}-${idx}`} className="relative">
                                    <CardTile id={id} onPlay={disabled ? undefined : () => {
                                        if (wantsTarget && allEnemies.length > 0) {
                                            // toggle selection for this card when targeting
                                            setPendingIdx(prev => (prev === idx ? null : idx));
                                        } else {
                                            // clear any pending target then play immediately
                                            if (pendingIdx != null) setPendingIdx(null);
                                            play(idx);
                                        }
                                    }} st={state} />

                                    <div className="absolute -top-2 -right-2">
                                        <span className={`rounded-full text-white text-xs px-2 py-0.5 ${pendingIdx === idx ? 'bg-indigo-600' : 'bg-slate-800'}`}>#{idx}</span>
                                    </div>
                                </div>
                            );
                        })}
                        {(state as any).hand?.length === 0 && <div className="text-sm text-slate-500">Your hand is empty.</div>}
                    </div>
                    {pendingIdx != null && (
                        <div className="mt-2 text-sm text-indigo-700">Select an enemy to target…</div>
                    )}
                </section>

                <section className="rounded-2xl bg-white border p-4">
                    <div className="mb-2 font-semibold">Log</div>
                    <ol className="space-y-1 text-sm max-h-64 overflow-auto">
                        {(state as any).log?.map((line: string, i: number) => (
                            <li key={i} className="font-mono">{line}</li>
                        ))}
                    </ol>
                </section>
            </div>
        </div>
    );
}
