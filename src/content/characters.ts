import type { CardId } from './card_specs';

export type Character = {
  name: string;
  blurb: string;
  hpMax: number;
  energyMax: number;
  drawPerTurn: number;
  startingRelic?: string[];
  starter: {
    strikes: number;        // e.g., 3
    guards: number;         // e.g., 3
    randomUnique: number;   // e.g., 4
    signatureCards?: string[]; // optional: 1x each unless a card says otherwise
  };
  preferredArchetypes?: string[]; // optional future use
};

export const CHARACTERS = {
  // Example; replace with your real characters
  Ren: {
    name: 'Ren',
    blurb: 'Summons iron constructs and weapons. He can enhance these summoned objects in various ways.',
    hpMax: 75,
    energyMax: 3,
    drawPerTurn: 5,
    startingRelic: ['Black Cauldron'], // When combat starts, place one Awen: Empower in the player's hand.
    starter: {
      strikes: 3,        
      guards: 3,         
      randomUnique: 4, 
    },
    preferredArchetypes: ['IronSummoning'],
  },
  Winnifred: {
    name: 'Winnifred',
    blurb: 'A woman with a split personality. Her abilties change depending on the personality in control.',
    hpMax: 70,
    energyMax: 3,
    drawPerTurn: 5,
    startingRelic: ['Moon Devourer'], // Start combat in Ash form. When leaving Ash form, gain 1 energy.
    starter: {
      strikes: 3,        
      guards: 3,         
      randomUnique: 4, 
      signatureCards: ['AshenScale']
    },
    preferredArchetypes: ['Ash'],
  },
  Calaera: {
    name: 'Calaera',
    blurb: 'A rogue who has also learned the ways of a mage. Can switch between single target assasination and aoe attacks.',
    hpMax: 70,
    energyMax: 3,
    drawPerTurn: 5,
    startingRelic: ['Burning Blood'], // Start combat in Ember form. When leaving Ember form, apply 1 Burning to ALL enemies.
    starter: {
      strikes: 3,        
      guards: 3,         
      randomUnique: 4, 
    },
    preferredArchetypes: ['Ember'],
  },
  Tatsuya: {
    name: 'Tatsuya',
    blurb: 'A man with the soul of a feral beast. Sacrifices his own life force to decimate his foes.',
    hpMax: 80,
    energyMax: 3,
    drawPerTurn: 5,
    startingRelic: ['Cursed Bones'], // Whenever you lose HP, gain 1 block.
    starter: {
      strikes: 3,        
      guards: 3,         
      randomUnique: 4, 
    },
    preferredArchetypes: ['Vorpal'],
  },
  Enemy: {
    name: 'Enemy',
    blurb: 'Various interlopers, opponents, and antagonists you\'ll meet on your journey.',
    hpMax: 0,
    energyMax: 0,
    drawPerTurn: 0,
    startingRelic: [''],
    starter: {
      strikes: 0,        
      guards: 0,         
      randomUnique: 0, 
    },
    preferredArchetypes: ['Enemy'],
  }
} as const satisfies Record<string, Character>;

export type CharacterKey = keyof typeof CHARACTERS;