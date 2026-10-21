export const SPELLS_PER_PAGE = 8;

const CIRCLE_NAMES = [
  'First Circle',
  'Second Circle',
  'Third Circle',
  'Fourth Circle',
  'Fifth Circle',
  'Sixth Circle',
  'Seventh Circle',
  'Eighth Circle',
];

const MAGERY_MANA = [4, 6, 9, 11, 14, 20, 40, 50];

const MAGERY_NAMES = [
  'Clumsy', 'Create Food', 'Feeblemind', 'Heal', 'Magic Arrow', 'Night Sight', 'Reactive Armor', 'Weaken',
  'Agility', 'Cunning', 'Cure', 'Harm', 'Magic Trap', 'Magic Untrap', 'Protection', 'Strength',
  'Bless', 'Fireball', 'Magic Lock', 'Poison', 'Telekinesis', 'Teleport', 'Unlock', 'Wall of Stone',
  'Arch Cure', 'Arch Protection', 'Curse', 'Fire Field', 'Greater Heal', 'Lightning', 'Mana Drain', 'Recall',
  'Blade Spirits', 'Dispel Field', 'Incognito', 'Magic Reflection', 'Mind Blast', 'Paralyze', 'Poison Field', 'Summon Creature',
  'Dispel', 'Energy Bolt', 'Explosion', 'Invisibility', 'Mark', 'Mass Curse', 'Paralyze Field', 'Reveal',
  'Chain Lightning', 'Energy Field', 'Flamestrike', 'Gate Travel', 'Mana Vampire', 'Mass Dispel', 'Meteor Swarm', 'Polymorph',
  'Earthquake', 'Energy Vortex', 'Resurrection', 'Air Elemental', 'Summon Daemon', 'Earth Elemental', 'Fire Elemental', 'Water Elemental',
];

const MAGERY_POWER_WORDS = [
  'Uus Jux', 'In Mani Ylem', 'Rel Wis', 'In Mani', 'In Por Ylem', 'In Lor', 'Flam Sanct', 'Des Mani',
  'Ex Uus', 'Uus Wis', 'An Nox', 'An Mani', 'In Jux', 'An Jux', 'Uus Sanct', 'Uus Mani',
  'Rel Sanct', 'Vas Flam', 'An Por', 'In Nox', 'Ort Por Ylem', 'Rel Por', 'Ex Por', 'In Sanct Ylem',
  'Vas An Nox', 'Vas Uus Sanct', 'Des Sanct', 'In Flam Grav', 'In Vas Mani', 'Por Ort Grav', 'Ort Rel', 'Kal Ort Por',
  'In Jux Hur Ylem', 'An Grav', 'Kal In Ex', 'In Jux Sanct', 'Por Corp Wis', 'An Ex Por', 'In Nox Grav', 'Kal Xen',
  'An Ort', 'Corp Por', 'Vas Ort Flam', 'An Lor Xen', 'Kal Por Ylem', 'Vas Des Sanct', 'In Ex Grav', 'Wis Quas',
  'Vas Ort Grav', 'In Sanct Grav', 'Kal Vas Flam', 'Vas Rel Por', 'Ort Sanct', 'Vas An Ort', 'Flam Kal Des Ylem', 'Vas Ylem Rel',
  'In Vas Por', 'Vas Corp Por', 'An Corp', 'Kal Vas Xen Hur', 'Kal Vas Xen Corp', 'Kal Vas Xen Ylem', 'Kal Vas Xen Flam', 'Kal Vas Xen An Flam',
];

const NECROMANCY_NAMES = [
  'Animate Dead', 'Blood Oath', 'Corpse Skin', 'Curse Weapon', 'Evil Omen', 'Horrific Beast', 'Lich Form', 'Mind Rot',
  'Pain Spike', 'Poison Strike', 'Strangle', 'Summon Familiar', 'Vampiric Embrace', 'Vengeful Spirit', 'Wither', 'Wraith Form',
  'Exorcism',
];

const NECROMANCY_POWER_WORDS = [
  'Uus Corp', 'In Jux Mani Xen', 'In Agle Corp Ylem', 'An Sanct Gra Char', 'Pas Tym An Sanct', 'Rel Xen Vas Bal', 'Rel Xen Corp Ort', 'Wis An Ben',
  'In Sar', 'In Vas Nox', 'In Bal Nox', 'Kal Xen Bal', 'Rel Xen An Sanct', 'Kal Xen Bal Beh', 'Kal Vas An Flam', 'Rel Xen Um',
  'Ort Corp Grav',
];

const NECROMANCY_MANA = [23, 13, 11, 7, 11, 11, 25, 17, 5, 17, 29, 17, 25, 41, 23, 17, 40];

const CHIVALRY_NAMES = [
  'Cleanse by Fire', 'Close Wounds', 'Consecrate Weapon', 'Dispel Evil', 'Divine Fury',
  'Enemy of One', 'Holy Light', 'Noble Sacrifice', 'Remove Curse', 'Sacred Journey',
];

const CHIVALRY_POWER_WORDS = [
  'Expor Flamus', 'Obsu Vulni', 'Consecrus Arma', 'Dispiro Malas', 'Divinum Furis',
  'Forul Solum', 'Augus Luminos', 'Dium Prostra', 'Extermo Vomica', 'Sanctum Viatas',
];

const BUSHIDO_NAMES = [
  'Honorable Execution', 'Confidence', 'Evasion', 'Counter Attack', 'Lightning Strike', 'Momentum Strike',
];

const NINJITSU_NAMES = [
  'Focus Attack', 'Death Strike', 'Animal Form', 'Ki Attack', 'Surprise Attack', 'Backstab', 'Shadowjump', 'Mirror Image',
];

const SPELLWEAVING_NAMES = [
  'Arcane Circle', 'Gift of Renewal', 'Immolating Weapon', 'Attunement', 'Thunderstorm', 'Nature\'s Fury', 'Summon Fey', 'Summon Fiend',
  'Reaper Form', 'Wildfire', 'Essence of Wind', 'Dryad Allure', 'Ethereal Voyage', 'Word of Death', 'Gift of Life', 'Arcane Empowerment',
];

const SPELLWEAVING_POWER_WORDS = [
  'Myrshalee', 'Olorisstra', 'Thalshara', 'Haeldril', 'Erelonia', 'Rauvvrae', 'Alalithra', 'Nylisstra',
  'Tarisstree', 'Haelyn', 'Anathrae', 'Rathril', 'Orlavdra', 'Nyraxle', 'Illorae', 'Aslavdra',
];

const SPELLWEAVING_MANA = [20, 24, 32, 24, 32, 24, 10, 10, 34, 50, 40, 40, 32, 50, 70, 50];

const MYSTICISM_NAMES = [
  'Nether Bolt', 'Healing Stone', 'Purge Magic', 'Enchant', 'Sleep', 'Eagle Strike', 'Animated Weapon', 'Stone Form',
  'Spell Trigger', 'Mass Sleep', 'Cleansing Winds', 'Bombard', 'Spell Plague', 'Hail Storm', 'Nether Cyclone', 'Rising Colossus',
];

const MYSTICISM_POWER_WORDS = [
  'In Corp Ylem', 'Kal In Mani', 'An Ort Sanct', 'In Ort Ylem', 'In Zu', 'Kal Por Xen', 'In Jux Por Ylem', 'In Rel Ylem',
  'In Vas Ort Ex', 'Vas Zu', 'In Vas Mani Hur', 'Corp Por Ylem', 'Vas Rel Jux Ort', 'Kal Des Ylem', 'Grav Hur', 'Kal Vas Xen Corp Ylem',
];

const MYSTICISM_MANA = [4, 4, 6, 6, 8, 9, 11, 11, 14, 14, 20, 20, 40, 50, 50, 50];

const MASTERY_NAMES = [
  'Inspire', 'Invigorate', 'Resilience', 'Perseverance', 'Tribulation', 'Despair', 'Death Ray', 'Ethereal Burst',
  'Nether Blast', 'Mystic Weapon', 'Command Undead', 'Conduit', 'Mana Shield', 'Summon Reaper', 'Enchanted Summoning', 'Anticipate Hit',
  'Warcry', 'Intuition', 'Rejuvenate', 'Holy Fist', 'Shadow', 'White Tiger Form', 'Flaming Shot', 'Playing The Odds',
  'Thrust', 'Pierce', 'Stagger', 'Toughness', 'Onslaught', 'Focused Eye', 'Elemental Fury', 'Called Shot',
  'Warrior\'s Gifts', 'Shield Bash', 'Bodyguard', 'Heighten Senses', 'Tolerance', 'Injected Strike', 'Potency', 'Rampage',
  'Fists of Fury', 'Knockout', 'Whispering', 'Combat Training', 'Boarding',
];

const MASTERY_POWER_WORDS = [
  'Uus Por', 'An Zu', 'Kal Mani Tym', 'Uus Jux Sanct', 'In Jux Hur Rel', 'Kal Des Mani Tym', 'In Grav Corp', 'Uus Ort Grav',
  'In Vas Xen Por', 'Vas Ylem Wis', 'In Corp Xen Por', 'Uus Corp Grav', 'Faerkulggen', 'Lartarisstree', '', '',
  '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '',
  '', '', '', '', '',
];

const MASTERY_MANA = [
  16, 22, 16, 18, 24, 26, 50, 0, 40, 40, 40, 40, 40, 50, 0, 10,
  40, 0, 10, 50, 10, 10, 30, 25, 30, 20, 20, 20, 20, 20, 20, 20,
  40, 50, 50, 40, 10, 20, 30, 0, 20, 20, 0, 40, 40,
];

const MASTERY_ICONS = [
  0x945, 0x946, 0x947, 0x948, 0x949, 0x94a, 0x9b8b, 0x9b8c, 0x9b8d, 0x9b8e, 0x9b8f, 0x9b90, 0x9b91, 0x9b92, 0x9b93,
  0x9b94, 0x9b95, 0x9b96, 0x9b97, 0x9b98, 0x9b99, 0x9b9a, 0x9b9b, 0x9b9c, 0x9b9d, 0x9b9e, 0x9b9f, 0x9ba0, 0x9ba1,
  0x9ba2, 0x9ba3, 0x9ba4, 0x9ba5, 0x9ba6, 0x9ba7, 0x9ba8, 0x9ba9, 0x9baa, 0x9bab, 0x9bac, 0x9bad, 0x9bae, 0x9baf,
  0x9bb0, 0x9bb1,
];

const SPELLBOOK_TYPES = [
  {
    key: 'magery',
    name: 'Magery',
    graphics: [0x0efa, 0x0e3b, 0x0e3c],
    iconStart: 0x08c0,
    names: MAGERY_NAMES,
    powerWords: MAGERY_POWER_WORDS,
    mana: MAGERY_NAMES.map((_, index) => MAGERY_MANA[index >> 3]),
    circles: CIRCLE_NAMES,
  },
  {
    key: 'necromancy',
    name: 'Necromancy',
    graphics: [0x2253],
    iconStart: 0x5000,
    names: NECROMANCY_NAMES,
    powerWords: NECROMANCY_POWER_WORDS,
    mana: NECROMANCY_MANA,
    idBase: 100,
  },
  {
    key: 'chivalry',
    name: 'Chivalry',
    graphics: [0x2252],
    iconStart: 0x5100,
    names: CHIVALRY_NAMES,
    powerWords: CHIVALRY_POWER_WORDS,
    mana: CHIVALRY_NAMES.map(() => null),
    idBase: 200,
  },
  {
    key: 'bushido',
    name: 'Bushido',
    graphics: [0x238c],
    iconStart: 0x5400,
    names: BUSHIDO_NAMES,
    powerWords: BUSHIDO_NAMES.map(() => ''),
    mana: BUSHIDO_NAMES.map(() => null),
    idBase: 400,
  },
  {
    key: 'ninjitsu',
    name: 'Ninjitsu',
    graphics: [0x23a0],
    iconStart: 0x5300,
    names: NINJITSU_NAMES,
    powerWords: NINJITSU_NAMES.map(() => ''),
    mana: NINJITSU_NAMES.map(() => null),
    idBase: 500,
  },
  {
    key: 'spellweaving',
    name: 'Spellweaving',
    graphics: [0x2d50],
    iconStart: 0x59d8,
    names: SPELLWEAVING_NAMES,
    powerWords: SPELLWEAVING_POWER_WORDS,
    mana: SPELLWEAVING_MANA,
    idBase: 600,
  },
  {
    key: 'mysticism',
    name: 'Mysticism',
    graphics: [0x2d9d],
    iconStart: 0x5dc0,
    names: MYSTICISM_NAMES,
    powerWords: MYSTICISM_POWER_WORDS,
    mana: MYSTICISM_MANA,
    idBase: 677,
  },
  {
    key: 'mastery',
    name: 'Mastery',
    graphics: [0x225a, 0x225b],
    iconStart: 0x945,
    icons: MASTERY_ICONS,
    names: MASTERY_NAMES,
    powerWords: MASTERY_POWER_WORDS,
    mana: MASTERY_MANA,
    idBase: 700,
  },
];

const DEFAULT_SPELLBOOK = SPELLBOOK_TYPES[0];

export function getSpellbookInfo(graphic) {
  const id = graphic >>> 0;
  return SPELLBOOK_TYPES.find((type) => type.graphics.includes(id)) || DEFAULT_SPELLBOOK;
}

export function getBookSpell(info, slot) {
  const index = slot - 1;
  const name = info.names[index];
  if (!name) return null;
  return {
    slot,
    index,
    id: (info.idBase || 0) + slot,
    name,
    powerWords: info.powerWords?.[index] || '',
    mana: info.mana?.[index] ?? null,
    icon: info.icons?.[index] ?? info.iconStart + index,
    circle: info.circles ? Math.floor(index / SPELLS_PER_PAGE) + 1 : 0,
  };
}

export function getBookSpells(info, slots, page) {
  const start = (page - 1) * SPELLS_PER_PAGE + 1;
  const end = Math.min(info.names.length, start + SPELLS_PER_PAGE - 1);
  const spells = [];
  for (let slot = start; slot <= end; slot++) {
    if (!slots?.has(slot)) continue;
    const spell = getBookSpell(info, slot);
    if (spell) spells.push(spell);
  }
  return spells;
}

export function getCircleName(info, page) {
  return info.circles?.[page - 1] || `Spells ${(page - 1) * SPELLS_PER_PAGE + 1}-${Math.min(info.names.length, page * SPELLS_PER_PAGE)}`;
}

export function findSpellByName(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return null;
  const schools = SPELLBOOK_TYPES.map((info) => ({
    info,
    exact: info.names.findIndex((name) => name.toLowerCase() === needle),
    partial: info.names.findIndex((name) => name.toLowerCase().includes(needle)),
  }));
  for (const school of schools) {
    if (school.exact >= 0) {
      return { ...getBookSpell(school.info, school.exact + 1), school: school.info.key };
    }
  }
  for (const school of schools) {
    if (school.partial >= 0) {
      return { ...getBookSpell(school.info, school.partial + 1), school: school.info.key };
    }
  }
  for (const info of SPELLBOOK_TYPES) {
    const id = Number(query);
    if (Number.isFinite(id) && id > 0) {
      const slot = id - (info.idBase || 0);
      if (slot >= 1 && slot <= info.names.length) {
        return { ...getBookSpell(info, slot), school: info.key };
      }
    }
  }
  return null;
}
