export type ActorId = 'player' | string;

export type LogEvent =
    | { kind: 'turn:start'; turn: number }
    | { kind: 'turn:end'; turn: number }
    | { kind: 'intent:set'; enemyId: ActorId; intent: any }
    | { kind: 'card:play'; who: ActorId; cardId: string; target?: ActorId; aoe?: boolean; energyBefore: number; energyAfter: number; cardName?: string }
    | { kind: 'damage'; source: ActorId; target: ActorId; base: number; modified: number; blocked: number; hpBefore: number; hpAfter: number; }
    | { kind: 'block:gain'; target: ActorId; amount: number; blockBefore: number; blockAfter: number }
    | { kind: 'status:apply'; target: ActorId; key: string; deltaStacks?: number; deltaDuration?: number; resultStacks?: number; resultDuration?: number }
    | { kind: 'status:decay'; target: ActorId; key: string; stepStacks?: number; stepDuration?: number; resultStacks?: number; resultDuration?: number; removed?: boolean }
    | { kind: 'pile:move'; cardId: string; from: string; to: string }
    | { kind: 'energy:change'; who: ActorId; delta: number; before: number; after: number }
    | { kind: 'diag'; msg: string }
    | { kind: 'status:snapshot'; where: string; player: any; enemies: any[] }
    | { kind: 'card:unplayable'; who: ActorId; cardId: string; cardName?: string; reason: string; requirement?: { type: 'status'; key: string; on?: ActorId } }
;

export function namesMap(st: any): Record<string,string> {
  const m: Record<string,string> = {};
  for (const e of (st.enemies ?? [])) if (e?.id) m[e.id] = e.name ?? e.id;
  m['player'] = st.player?.name ?? 'Player';
  return m;
}

function showWho(id?: string, ev?: any) {
  if (!id) return '—';
  const map = ev?.whoNames || {};
  return map[id] ?? id;
}

// ▶ Event bus (transport only)
let _listeners: Array<(e: LogEvent) => void> = [];
let _buffer: LogEvent[] = [];
let _renderEnabled = true;      // Phase 1: set false to stop legacy string logging
let _debug = false;             // controls math/trace in legacy printer

export function onEvent(f: (e: LogEvent) => void) { _listeners.push(f); return () => { _listeners = _listeners.filter(x => x !== f); }; }
export function flush(): LogEvent[] { const out = _buffer; _buffer = []; return out; }
export function snapshot(): readonly LogEvent[] { return _buffer; }
export function setRenderEnabled(on: boolean) { _renderEnabled = on; }
export function setDebugTrace(on: boolean) { _debug = on; }

export function emit(st: any, ev: LogEvent) {
  const withNames = { ...ev, whoNames: namesMap(st) } as LogEvent & { whoNames: Record<string,string> };
  _buffer.push(withNames);
  for (const f of _listeners) f(withNames);
  // legacy path: also push string line if enabled
  if (_renderEnabled) {
    const line = toText(withNames);
    if (line) st.log?.push(line);
  }
  // always keep structured events in state for replay/inspect
  st.events?.push(withNames);
}

// Backward‑compatible entrypoint (keeps existing call sites):
export function log(st: any, ev: LogEvent) { emit(st, ev); }

// === Legacy string formatting (will be disabled by setRenderEnabled(false))
export function toText(ev: LogEvent): string {
  switch (ev.kind) {
    case 'turn:start': return `–– Turn ${ev.turn} begins ––`;
    case 'turn:end':   return `–– Turn ${ev.turn} ends ––`;
    case 'intent:set': {
      const who = showWho(ev.enemyId, ev);
      return `[intent] ${who} → ${prettyIntent(ev.intent)}`;
    }
    case 'card:play': {
      const who = showWho(ev.who, ev);
      const tgt = ev.aoe ? 'everyone' : (ev.target ? showWho(ev.target, ev) : '');
      const tail = ev.aoe ? ' (AOE)' : (tgt ? ` on ${tgt}` : '');
      const card = (ev as any).cardName ?? ev.cardId;
      return `[play] ${who} played ${card}${tail} (E: ${ev.energyBefore}→${ev.energyAfter})`;
    }
    case 'damage': {
      const src = ev.source === 'status:Burning' ? 'status:Burning' : showWho(ev.source as any, ev);
      const dst = showWho(ev.target, ev);
      const base = (ev as any).base ?? 0;
      const mod  = (ev as any).modified ?? base;
      const blk  = (ev as any).blocked ?? 0;
      const hpB  = (ev as any).hpBefore ?? '-';
      const hpA  = (ev as any).hpAfter ?? '-';
      return `[dmg] ${src} → ${dst}: ${mod} (base ${base}, blocked ${blk}) HP ${hpB}→${hpA}`;
    }
    case 'block:gain': {
      const who = showWho(ev.target, ev);
      return `[block] ${who} +${ev.amount} (Block ${ev.blockBefore}→${ev.blockAfter})`;
    }
    case 'status:apply': {
      const who = showWho(ev.target, ev);
      return `[status+] ${who} ${ev.key} (ΔS ${ev.deltaStacks ?? 0}) → S:${ev.resultStacks ?? 0}`;
    }
    case 'status:decay': {
      const who = showWho(ev.target, ev);
      const removed = ev.removed ? ' [removed]' : '';
      return `[status↓] ${who} ${ev.key} (−S ${ev.stepStacks ?? 0}) → S:${ev.resultStacks ?? 0}${removed}`;
    }
    case 'pile:move':     return `[pile] ${ev.cardId}: ${ev.from} → ${ev.to}`;
    case 'energy:change': return `[energy] ${showWho(ev.who, ev)} ${ev.delta >= 0 ? '+' : ''}${ev.delta} (E ${ev.before}→${ev.after})`;
    case 'diag':          return `[diag] ${ev.msg}`;
    case 'status:snapshot': return ''; // keep structured only
  }
}

export const DEBUG_STATUS = true;

const SNAP_CODES: Record<string, string> = {
    Weak: 'W',
    Exposed: 'X',
    Burning: 'B',
    Empower: 'Emp',   // ▶ unify label; was 'Str'
    Scales: 'Sc',
    CantAct: 'CA',
};

function shortStatusList(m: Record<string, any> | undefined) {
    if (!m) return '-';
    const order = ['Weak', 'Exposed', 'Burning', 'Empower', 'Scales', 'CantAct'];
    const parts: string[] = [];
    for (const k of order) {
        const s = m[k]?.stacks ?? 0;
        if (s > 0) parts.push(`${SNAP_CODES[k] ?? k}:${s}`);
    }
    for (const k of Object.keys(m)) {
        if (order.includes(k)) continue;
        const s = m[k]?.stacks ?? 0;
        if (s > 0) parts.push(`${(SNAP_CODES[k] ?? k)}:${s}`);
    }
    return parts.length ? parts.join(', ') : '-';
}

export function logStatusSnapshot(st: any, where: string) {
    if (!DEBUG_STATUS) return;
    const rows: string[] = [];
    rows.push(`Player(${shortStatusList(st.player?.statuses)})`);
    for (const e of (st.enemies ?? [])) {
        const name = e?.name ?? e?.id ?? 'Enemy';
        rows.push(`${name}(${shortStatusList(e?.statuses)})`);
    }
    const line = `[snap] ${where}: ` + rows.join(' | ');
    st.log?.push(line);
    st.events?.push({ kind: 'status:snapshot', where, player: st.player?.statuses ?? {}, enemies: (st.enemies ?? []).map((e: any) => ({ id: e.id, name: e.name, st: e.statuses })) });
}

function n(v: any, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function f2(v: any) { return n(v, 1).toFixed(2); }

export function logDamageTrace(st: any, a: {
  srcId: string,
  dstId: string,
  base?: number,
  emp?: number,
  outMul?: number,
  inMul?: number,
  reduced?: number,
  blocked?: number,
  final?: number,
  dot?: boolean
}) {
  const map = namesMap(st);
  const src = map[a.srcId] ?? a.srcId;
  const dst = map[a.dstId] ?? a.dstId;

  const base   = n(a.base);
  const emp    = n(a.emp);
  const outMul = n(a.outMul, 1);
  const inMul  = n(a.inMul, 1);
  const reduced = n(a.reduced);
  const blocked = n(a.blocked);
  const final   = n(a.final, Math.max(0, Math.floor(base * outMul * inMul - reduced - blocked)));

  const empStr = emp > 0 ? ` +Emp${emp}` : '';
  const tag = a.dot ? 'status:Burning' : src;

  // ▶ keep for deep debug; disable via setRenderEnabled(false)
  st.log?.push(
    `[trace] ${tag}→${dst} base ${base}${empStr} ×Out${f2(outMul)} ×In${f2(inMul)} = ${Math.floor(base * outMul * inMul)} -Red${reduced} -Blk${blocked} ⇒ ${final}`
  );
}

export function whoName(st: any, id?: string) {
  if (id === 'player') return st.player?.name ?? 'Player';
  const e = (st.enemies ?? []).find((x: any) => x.id === id);
  return e?.name ?? id ?? '—';
}

function prettyIntent(i: any) {
    if (!i) return '…';
    if (i.kind === 'attack') return `Attack ${i.value ?? 0}`;
    if (i.kind === 'defend') return `Defend ${i.value ?? 0}`;
    if (i.kind === 'debuff') return `Debuff ${i.status?.key ?? ''} +${i.status?.stacks ?? 0}`;
    return String(i.kind ?? '…');
}