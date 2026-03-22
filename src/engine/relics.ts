import { Relic } from './types';

export const RELICS: Record<string, Relic> = {
  'Moon Devourer': {
    key: 'Moon Devourer',
    name: 'Moon Devourer',
    text: 'Start combat in Ash form. When leaving Ash form, gain 1 Energy.',
    onCombatStart: (ctx, id) => { ctx.state.entities[id].form = 'Ash'; },
    onFormChange: (ctx, id, from, to) => {
      if (from === 'Ash' && to !== 'Ash') ctx.gainEnergy(id, 1);
    },
  },
  'Burning Blood': {
    key: 'Burning Blood',
    name: 'Burning Blood',
    text: 'Start combat in Ember form. When leaving Ember form, apply 1 Burning to ALL enemies.',
    onCombatStart: (ctx, id) => { ctx.state.entities[id].form = 'Ember'; },
    onFormChange: (ctx, id, from, to) => {
      if (from === 'Ember' && to !== 'Ember') {
        for (const enemy of ctx.enemiesOf(id)) ctx.applyStatus(enemy.id, 'Burning', 1);
      }
    },
  },
};
