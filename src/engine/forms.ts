// Forms state API — source of truth for reading/changing forms

export type Form = 'Ash' | 'Ember' | null;

type Side = 'player' | 'enemy';

function whoKey(whoId: string): Side {
  return whoId === 'enemy' ? 'enemy' : 'player';
}

export function getForm(st: any, whoId: string): Form {
  const who = whoKey(whoId);
  return st?.[who]?.form ?? null;
}

export function canChangeForm(_st: any, _whoId: string, _next: Form): boolean {
  // Gate for special requirements to enter a form (e.g., EmberCharge). Override as needed.
  return true;
}

export function onExit(_st: any, _whoId: string, _prev: Form) {
  // One-time cleanup when leaving a form. Override as needed.
}

export function onEnter(_st: any, _whoId: string, _next: Form) {
  // One-time effects when entering a form. Override as needed.
}

export function changeForm(st: any, whoId: string, next: Form) {
  const who = whoKey(whoId);
  if (!st[who]) return;
  const prev = st[who].form ?? null;
  if (prev === next) return;
  if (!canChangeForm(st, whoId, next)) return;
  onExit(st, whoId, prev);
  st[who].form = next;
  onEnter(st, whoId, next);
}