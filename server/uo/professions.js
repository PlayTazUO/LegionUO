import fs from 'node:fs';

// Prof.txt uses display names that do not always match skills.mul exactly.
// Normalising removes spaces and punctuation, then these aliases bridge the
// remaining spelling differences (for example Blacksmith -> Blacksmithy).
const SKILL_ALIASES = {
  blacksmith: 'blacksmithy',
  evaluateintelligence: 'evaluatingintelligence',
  evaluateint: 'evaluatingintelligence',
  evaluatingint: 'evaluatingintelligence',
  itemid: 'itemidentification',
  armslore: 'armslore',
  bowcraft: 'bowcraftfletching',
  fletching: 'bowcraftfletching',
  resisting: 'resistingspells',
  animaltaming: 'animaltaming',
};

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '#' || ch === ';') break;
    if (/[\s,]/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function emptyBlock() {
  return {
    name: '',
    trueName: '',
    type: '',
    topLevel: false,
    graphic: 0,
    nameId: 0,
    descId: 0,
    descriptionIndex: 0,
    stats: { str: 0, dex: 0, int: 0 },
    skills: [],
  };
}

export class ProfessionsManager {
  constructor(files, skills) {
    this.files = files;
    this.skills = skills;
    this.loaded = false;
    this.list = [];
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;

    const file = this.files.find('Prof.txt');
    if (!file) return;

    const skillByKey = new Map();
    for (const skill of this.skills.toJSON()) {
      const key = normalise(skill.name);
      if (key && !skillByKey.has(key)) skillByKey.set(key, skill.index);
    }

    let text;
    try {
      text = fs.readFileSync(file, 'latin1');
    } catch {
      return;
    }

    let block = null;
    for (const line of text.split(/\r?\n/)) {
      const tokens = tokenize(line);
      if (!tokens.length) continue;
      const key = tokens[0].toLowerCase();

      if (key === 'begin') {
        block = emptyBlock();
        continue;
      }
      if (!block) continue;
      if (key === 'end') {
        if (block.type === 'profession' && block.name) this.list.push(block);
        block = null;
        continue;
      }

      const rest = tokens.slice(1);
      switch (key) {
        case 'name':
          block.name = rest.join(' ');
          break;
        case 'truename':
          block.trueName = rest.join(' ');
          break;
        case 'nameid':
          block.nameId = parseInt(rest[0], 10) || 0;
          break;
        case 'descid':
          block.descId = parseInt(rest[0], 10) || 0;
          break;
        case 'desc':
          block.descriptionIndex = parseInt(rest[0], 10) || 0;
          break;
        case 'toplevel':
          block.topLevel = String(rest[0] || '').toLowerCase() === 'true';
          break;
        case 'gump':
          block.graphic = parseInt(rest[0], 10) || 0;
          break;
        case 'type':
          block.type = String(rest[0] || '').toLowerCase();
          break;
        case 'stat': {
          const stat = String(rest[0] || '').toLowerCase();
          const value = parseInt(rest[rest.length - 1], 10) || 0;
          if (stat === 'str') block.stats.str = value;
          else if (stat === 'dex') block.stats.dex = value;
          else if (stat === 'int') block.stats.int = value;
          break;
        }
        case 'skill': {
          if (rest.length < 2) break;
          const value = parseInt(rest[rest.length - 1], 10) || 0;
          const name = rest.slice(0, -1).join(' ');
          let lookup = normalise(name);
          lookup = SKILL_ALIASES[lookup] || lookup;
          let index = skillByKey.get(lookup);
          if (index == null) {
            index = skillByKey.get(normalise(name));
          }
          if (index != null) block.skills.push({ index, value });
          break;
        }
        default:
          break;
      }
    }
  }

  toJSON() {
    this.load();
    return this.list;
  }
}
