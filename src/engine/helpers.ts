import type { CardParams, DisplayFields, RenderDict, RenderExtra } from './types';
import type { CombatState } from './combat';

export function humanizeTag(tag: string): string {
    return tag
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Irregular player-facing names for statuses (ASCII apostrophe version).
export const STATUS_DISPLAY: Record<string, string> = {
    CantAct: "Can't Act",
    // Add more one-offs here if needed
    // e.g., CannotAct: "Can't act"
};

// Map param keys → canonical status ids used in state
export function statusIdFromParamKey(k: string): string {
    switch (k) {
        case 'cantAct': return 'CantAct';
        case 'weak': return 'Weak';
        case 'exposed': return 'Exposed';
        default: return k;
    }
}

export function targetsFromAoe(aoe?: boolean): string {
    return aoe ? 'ALL enemies' : 'an enemy';
}

export function factorLabel(factor: number): string {
    if (factor === 2) return 'Double';
    if (factor === 3) return 'Triple';
    return `x${factor}`;
}

export function statusText(name: string, stacks: number): string {
    return `${stacks} ${name}`;
}

function get(obj: any, path: string) {
    return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function deepMerge<T extends Record<string, any>>(...objs: T[]): T {
    const out: Record<string, any> = {};
    for (const o of objs) mergeInto(out, o);
    return out as T;
}

function mergeInto(dst: Record<string, any>, src: Record<string, any>) {
    for (const k in src) {
        const sv = src[k];
        if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
            dst[k] = mergeInto(dst[k] || {}, sv);
        } else {
            dst[k] = sv;
        }
    }
    return dst;
}

export function statusLabel(raw: string): string {
    if (!raw) return '';

    // 1) Exact override for irregular cases
    const override = STATUS_DISPLAY[raw];
    if (override) return override;

    // 2) Generic humanization: snake/camel → words
    let s = String(raw)
        .replace(/[_-]+/g, ' ')                // snake/kebab -> spaces
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')// camelCase -> spaces
        .trim();

    // 3) Normalize common contractions (ASCII apostrophes)
    //    (Use \u2019 if you prefer typographic apostrophes.)
    s = s
        .replace(/\bCant\b/gi, "Can't")
        .replace(/\bDont\b/gi, "Don't")
        .replace(/\bWont\b/gi, "Won't");

    // 4) Title-case with small-words lowercased (except first word)
    const SMALL = new Set(['and', 'or', 'the', 'of', 'to', 'in', 'on', 'for', 'a', 'an']);
    const words = s.toLowerCase().split(/\s+/);
    const titled = words.map((w, i) =>
        (i === 0 || !SMALL.has(w)) ? (w.charAt(0).toUpperCase() + w.slice(1)) : w
    ).join(' ');

    return titled;
}

export function deriveDisplay(p: CardParams, extra: RenderExtra = {}): DisplayFields {
    const out: DisplayFields = {};

    // Basic labels
    if (typeof p.tag === 'string') out.tagLabel = humanizeTag(p.tag);
    if ('aoe' in p) out.targets = targetsFromAoe(!!p.aoe);
    if (typeof p.factor === 'number') out.factorLabel = factorLabel(p.factor);

    // Status text + plain aliases for templates that expect {burning}/{weak}/{exposed}
    if (typeof p.burning === 'number') {
        out.burningText = statusText('Burning', p.burning);
        (out as any).burning = out.burningText;
    }
    if (typeof p.weak === 'number') {
        out.weakText = statusText('Weak', p.weak);
        (out as any).weak = out.weakText;
    }
    if (typeof p.exposed === 'number') {
        out.exposedText = statusText('Exposed', p.exposed);
        (out as any).exposed = out.exposedText;
    }

    // Conditional Ember fields
    if (p.ifEmber?.aoe !== undefined) {
        out.ifEmber = { ...(out.ifEmber ?? {}), targets: targetsFromAoe(!!p.ifEmber.aoe) };
    }
    if (typeof p.ifEmber?.burning === 'number') {
        out.ifEmber = { ...(out.ifEmber ?? {}), burningText: statusText('Burning', p.ifEmber.burning) };
        if (!(out as any).burning) (out as any).burning = (out.ifEmber as any).burningText;
    }

    // Plus/Requires helpers
    if (p.plus?.tag) {
        out.plus = { ...(out.plus ?? {}), tagLabel: humanizeTag(p.plus.tag) };
        if (typeof p.plus.amount === 'number') (out.plus as any).amount = p.plus.amount;
    }
    // Compatibility: if a spec switched to { amount } (e.g., gainEmpower) but text still uses {plus.amount}
    if (typeof (p as any).amount === 'number') {
        (out as any).plus = { ...(out as any).plus, amount: (p as any).amount };
    }

    if (p.requires?.tag) {
        out.requires = { ...(out.requires ?? {}), tagLabel: humanizeTag(p.requires.tag) };
    }
    if (p.requires?.status) {
        out.requires = { ...(out.requires ?? {}), statusLabel: statusLabel(String(p.requires.status)) };
        (out as any).status = (out.requires as any).statusLabel;
    }

    // Card name resolver via extra.cardNameMap; support multiple casings for id in params
    const rawId = (p as any).cardId ?? (p as any).CardId ?? (p as any).cardID ?? (p as any).CardID;
    if (rawId && extra.cardNameMap && extra.cardNameMap[rawId]) {
        (out as any).cardName = extra.cardNameMap[rawId];
    }

    // Extra-hit display helpers (declarative)
    if ((p as any).extraHit) {
        const eh: any = (p as any).extraHit;
        const moreHits = typeof eh.hits === 'number' ? eh.hits : 0;
        const perHit = (eh.damage != null ? eh.damage : p.damage) as number | undefined;
        (out as any).extraHit = { ...(out as any).extraHit };
        if (typeof moreHits === 'number' && moreHits > 0) {
            (out as any).extraHit.moreTimesText = moreHits === 1 ? '1 more time' : `${moreHits} more times`;
            (out as any).extraHit.hits = moreHits;
        }
        if (typeof perHit === 'number') {
            (out as any).extraHit.damage = perHit;
        }
        if (eh.condition?.form) {
            (out as any).extraHit.condition = { form: String(eh.condition.form) };
        }
    }

    return out;
}

export function renderCardText(spec: any, extra?: Record<string, any>, st?: CombatState): string {
    const tpl = String(spec?.text ?? '');
    const params = (spec as any)?.params ?? {};
    // Build dictionary so classic placeholders like {damage}, {block}, {cost.hp} keep working
    const dict: RenderDict = deepMerge({}, params, deriveDisplay(params, extra as any), (extra as any) || {});

    // If we have live state, layer dynamic values
    if (st) {
        // expose under the same shapes the templates expect
        (dict as any).source = {
            ...(dict as any).source,
            damageTakenThisTurn: (st.player as any).turnDamageTaken ?? 0,
        };
        (dict as any).empower = {
            ...(dict as any).empower,
            stacks: st.player?.statuses?.Empower?.stacks ?? 0,
        };
        (dict as any).player = { ...(dict as any).player, block: st.player?.block ?? 0 };
        (dict as any).enemy  = { ...(dict as any).enemy,  block: st.enemy?.block  ?? 0 };
    }

    // Replace {foo} / {a.b.c}
    const out = tpl.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, path) => {
        const v = get(dict, path);
        if (v == null && path === 'source.damageTakenThisTurn') {
            const preview = (extra as any)?.source?.damageTakenThisTurn;
            return preview != null ? String(preview) : 'damage taken this turn';
        }
        return v == null ? `{${path}}` : String(v);
    });

    return out.trim().length ? out : tpl;
}

export default { humanizeTag, targetsFromAoe, factorLabel, statusText, deriveDisplay, renderCardText };
