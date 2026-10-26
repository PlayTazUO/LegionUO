import { versionValue } from '../net/packet-length.js';

const CV_4011D = 0x04000b64;
const CV_60144 = 0x06000e04;
const CV_7000 = 0x07000000;
const CV_70160 = 0x07001000;

const HUMAN_SKIN_TONE = [
  0x03e9, 0x03f1, 0x03f9, 0x0401, 0x0409, 0x0411, 0x0419, 0x0421, 0x03ea, 0x03f2, 0x03fa, 0x0402, 0x040a,
  0x0412, 0x041a, 0x0421, 0x03eb, 0x03f3, 0x03fb, 0x0403, 0x040b, 0x0413, 0x041b, 0x0421, 0x03ec, 0x03f4,
  0x03fc, 0x0404, 0x040c, 0x0414, 0x041c, 0x0421, 0x03ed, 0x03f5, 0x03fd, 0x0405, 0x040d, 0x0415, 0x041d,
  0x0421, 0x03ee, 0x03f6, 0x03fe, 0x0406, 0x040e, 0x0416, 0x041e, 0x0421, 0x03ef, 0x03f7, 0x03ff, 0x0407,
  0x040f, 0x0417, 0x041f, 0x0421, 0x03f0, 0x03f8, 0x0400, 0x0408, 0x0410, 0x0418, 0x0420, 0x0421,
];
const ELF_SKIN_TONE = [
  0x04dd, 0x076b, 0x0834, 0x042f, 0x024c, 0x024d, 0x024e, 0x00be, 0x04a6, 0x0360, 0x0374, 0x0366, 0x03e7,
  0x03dd, 0x0352, 0x0902, 0x076c, 0x0383, 0x0578, 0x03e8, 0x0373, 0x0388, 0x0384, 0x0375, 0x053e, 0x0380,
  0x0381, 0x0382, 0x076a, 0x03e4, 0x051c, 0x03e5,
];
const GARGOYLE_SKIN_TONE = [
  0x06da, 0x06db, 0x06dc, 0x06dd, 0x06de, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e3, 0x06e4, 0x06e5, 0x06e6,
  0x06e7, 0x06e8, 0x06e9, 0x06ea, 0x06eb, 0x06ec, 0x06ed, 0x06ee, 0x06ef, 0x06f0, 0x06f1, 0x06f2, 0x06da,
  0x06db, 0x06dc,
];
const HUMAN_HAIR_COLOR = [
  0x044d, 0x0455, 0x045d, 0x0465, 0x046d, 0x0475, 0x044e, 0x0456, 0x045e, 0x0466, 0x046e, 0x0476, 0x044f,
  0x0457, 0x045f, 0x0467, 0x046f, 0x0477, 0x0450, 0x0458, 0x0460, 0x0468, 0x0470, 0x0478, 0x0451, 0x0459,
  0x0461, 0x0469, 0x0471, 0x0479, 0x0452, 0x045a, 0x0462, 0x046a, 0x0472, 0x047a, 0x0453, 0x045b, 0x0463,
  0x046b, 0x0473, 0x047b, 0x0454, 0x045c, 0x0464, 0x046c, 0x0474, 0x047c,
];
const ELF_HAIR_COLOR = [
  0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0100, 0x06b7, 0x0206, 0x0210, 0x026b, 0x02c2, 0x02c8,
  0x01e3, 0x0238, 0x0368, 0x059c, 0x0852, 0x008d, 0x008e, 0x008f, 0x0090, 0x0091, 0x0158, 0x0159, 0x015a,
  0x015b, 0x015c, 0x015d, 0x01bc, 0x0724, 0x0057, 0x0127, 0x012e, 0x01f2, 0x0250, 0x031c, 0x031d, 0x031e,
  0x031f, 0x0320, 0x0321, 0x0322, 0x0323, 0x0324, 0x0325, 0x0385, 0x0386, 0x0387, 0x0388, 0x0389, 0x0385,
  0x0386, 0x0387,
];
const GARGOYLE_HAIR_COLOR = [
  0x0708, 0x070a, 0x070c, 0x070e, 0x0710, 0x0762, 0x0764, 0x0767, 0x076a, 0x06f2, 0x06f0, 0x06ee, 0x06e3,
  0x06e1, 0x06df, 0x0708, 0x070a, 0x070c,
];

const HUMAN_HAIR_LABELS = [3000340, 3000341, 3000342, 3000343, 3000344, 3000345, 3000346, 3000347, 3000348, 3000349];
const HUMAN_HAIR_GRAPHICS = [0, 8251, 8252, 8253, 8260, 8261, 8266, 8263, 8264, 8265];
const HUMAN_FACIAL_LABELS = [3000340, 3000351, 3000352, 3000353, 3000354, 1011060, 1011061, 3000357];
const HUMAN_FACIAL_GRAPHICS = [0, 8256, 8254, 8255, 8257, 8267, 8268, 8269];
const HUMAN_FEMALE_HAIR_LABELS = [3000340, 3000341, 3000342, 3000343, 3000344, 3000345, 3000346, 3000347, 3000349, 3000350];
const HUMAN_FEMALE_HAIR_GRAPHICS = [0, 8251, 8252, 8253, 8260, 8261, 8266, 8263, 8265, 8262];
const ELF_HAIR_LABELS = [3000340, 1074385, 1074386, 1074387, 1074388, 1074390, 1074391, 1074392, 1074394];
const ELF_HAIR_GRAPHICS = [0, 0x2fbf, 0x2fc0, 0x2fc1, 0x2fc2, 0x2fcd, 0x2fce, 0x2fcf, 0x2fd1];
const ELF_FEMALE_HAIR_LABELS = [3000340, 1074386, 1074387, 1074388, 1074389, 1074391, 1074392, 1074393, 1074394];
const ELF_FEMALE_HAIR_GRAPHICS = [0, 0x2fc0, 0x2fc1, 0x2fc2, 0x2fcc, 0x2fce, 0x2fcf, 0x2fd0, 0x2fd1];
const GARGOYLE_HAIR_LABELS = [3000340, 1112310, 1112311, 1112312, 1112313, 1112314, 1112315, 1112316, 1112317];
const GARGOYLE_HAIR_GRAPHICS = [0, 0x4258, 0x4259, 0x425a, 0x425b, 0x425c, 0x425d, 0x425e, 0x425f];
const GARGOYLE_FACIAL_LABELS = [3000340, 1112310, 1112311, 1112312, 1112313];
const GARGOYLE_FACIAL_GRAPHICS = [0, 0x42ad, 0x42ae, 0x42af, 0x42b0];
const GARGOYLE_FEMALE_HAIR_LABELS = [3000340, 1112310, 1112311, 1112312, 1112313, 1112314, 1112315, 1112316, 1112317];
const GARGOYLE_FEMALE_HAIR_GRAPHICS = [0, 0x4261, 0x4262, 0x4273, 0x4274, 0x4275, 0x42aa, 0x42ab, 0x42b1];

const RACE_NAMES = { 1: 'Human', 2: 'Elf', 3: 'Gargoyle' };

const RACE_DATA = {
  1: {
    skin: HUMAN_SKIN_TONE,
    hairColors: HUMAN_HAIR_COLOR,
    hair: { male: HUMAN_HAIR_GRAPHICS, female: HUMAN_FEMALE_HAIR_GRAPHICS },
    hairLabels: { male: HUMAN_HAIR_LABELS, female: HUMAN_FEMALE_HAIR_LABELS },
    facial: HUMAN_FACIAL_GRAPHICS,
    facialLabels: HUMAN_FACIAL_LABELS,
    body: { male: 0x0190, female: 0x0191 },
    clothes: {
      male: { shoes: 0x1710, pants: 0x152f, shirt: 0x1518 },
      female: { shoes: 0x1710, skirt: 0x1531, shirt: 0x1518 },
    },
  },
  2: {
    skin: ELF_SKIN_TONE,
    hairColors: ELF_HAIR_COLOR,
    hair: { male: ELF_HAIR_GRAPHICS, female: ELF_FEMALE_HAIR_GRAPHICS },
    hairLabels: { male: ELF_HAIR_LABELS, female: ELF_FEMALE_HAIR_LABELS },
    facial: null,
    facialLabels: null,
    body: { male: 0x025d, female: 0x025e },
    clothes: {
      male: { shoes: 0x1710, pants: 0x152f, shirt: 0x1518 },
      female: { shoes: 0x1710, skirt: 0x1531, shirt: 0x1518 },
    },
  },
  3: {
    skin: GARGOYLE_SKIN_TONE,
    hairColors: GARGOYLE_HAIR_COLOR,
    hair: { male: GARGOYLE_HAIR_GRAPHICS, female: GARGOYLE_FEMALE_HAIR_GRAPHICS },
    hairLabels: { male: GARGOYLE_HAIR_LABELS, female: GARGOYLE_FEMALE_HAIR_LABELS },
    facial: GARGOYLE_FACIAL_GRAPHICS,
    facialLabels: GARGOYLE_FACIAL_LABELS,
    body: { male: 0x029a, female: 0x029b },
    clothes: {
      male: { robe: 0x4001 },
      female: { robe: 0x4001 },
    },
  },
};

const FALLBACK_PROFESSIONS = [
  {
    name: 'Warrior',
    trueName: 'warrior',
    descriptionIndex: 1,
    stats: { str: 45, dex: 35, int: 10 },
    skills: [
      { index: 27, value: 30 },
      { index: 17, value: 30 },
      { index: 40, value: 30 },
      { index: 1, value: 30 },
    ],
  },
  {
    name: 'Mage',
    trueName: 'mage',
    descriptionIndex: 2,
    stats: { str: 25, dex: 20, int: 45 },
    skills: [
      { index: 25, value: 30 },
      { index: 46, value: 30 },
      { index: 16, value: 30 },
      { index: 43, value: 30 },
    ],
  },
  {
    name: 'Blacksmith',
    trueName: 'blacksmith',
    descriptionIndex: 3,
    stats: { str: 60, dex: 15, int: 15 },
    skills: [
      { index: 7, value: 30 },
      { index: 37, value: 30 },
      { index: 45, value: 30 },
      { index: 34, value: 30 },
    ],
  },
];

let professionSourcePromise = null;

function sum(object) {
  return Object.values(object).reduce((total, value) => total + (Number(value) || 0), 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomIndex(length) {
  return length > 0 ? Math.floor(Math.random() * length) : 0;
}

function applyBudgetChange(values, key, next, keys, min, max) {
  const old = values[key];
  next = clamp(next, min, max);
  const delta = next - old;
  if (!delta) return;

  values[key] = next;
  const others = keys.filter((item) => item !== key);

  if (delta > 0) {
    let remaining = delta;
    for (const other of others) {
      if (remaining <= 0) break;
      const room = values[other] - min;
      if (room <= 0) continue;
      const take = Math.min(room, remaining);
      values[other] -= take;
      remaining -= take;
    }
    if (remaining > 0) values[key] -= remaining;
  } else {
    let remaining = -delta;
    for (const other of others) {
      if (remaining <= 0) break;
      const room = max - values[other];
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      values[other] += add;
      remaining -= add;
    }
    if (remaining > 0) values[key] += remaining;
  }
}

function option(value, text) {
  const item = document.createElement('option');
  item.value = String(value);
  item.textContent = text;
  return item;
}

export class CharCreationWizard {
  constructor(ui, cities = []) {
    this.ui = ui;
    this.game = ui.game;
    this.world = ui.world;
    this.assets = this.game.assets;
    this.cities = Array.isArray(cities) && cities.length ? cities : [{ index: 0, name: 'Britain' }];
    this.version = versionValue(this.game.config?.clientVersion || '7.0.104.0');
    this.skillCount = this.version >= CV_70160 ? 4 : 3;
    this.allowElf = this.version >= CV_4011D;
    this.allowGargoyle = this.version >= CV_60144;

    this.hueCount = this.ui.hues?.count || 3000;
    this.shirtHues = [2];
    for (let i = 0; i < 200; i++) {
      const hue = 3 + i * 5;
      if (hue < this.hueCount) this.shirtHues.push(hue);
    }

    this.race = 1;
    this.female = false;
    this.hairStyle = 1;
    this.facialStyle = 0;
    this.professionValue = 255;
    this.professions = [];
    this.profession = null;

    const skillInfo = this.ui.skillInfo?.length ? this.ui.skillInfo : this.world.skillList || [];
    this.skillList = [...skillInfo].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    this.animCache = new Map();
    this.previewToken = 0;

    this.resetAppearance();
    this.resetAdvanced();
  }

  resetAppearance() {
    const data = RACE_DATA[this.race];
    this.skinHue = data.skin[0] + 1;
    this.hairHue = data.hairColors[0] + 1;
    this.beardHue = this.hairHue;
    this.shirtHue = 2;
    this.pantsHue = 2;
    this.hairStyle = Math.min(1, this.hairGraphics().length - 1);
    this.facialStyle = 0;
  }

  resetAdvanced() {
    const modern = this.version >= CV_70160;
    const stats = modern ? { str: 60, dex: 15, int: 15 } : { str: 60, dex: 10, int: 10 };
    const values = modern ? [30, 30, 30, 30] : [50, 50, 0];
    const fallback = [27, 17, 40, 1];
    this.stats = { ...stats };
    this.statBudget = sum(stats);
    this.skillSlots = Array.from({ length: this.skillCount }, (_, i) => ({
      index: fallback[i] ?? 0,
      value: values[i] ?? 0,
    }));
    this.skillBudget = this.skillSlots.reduce((total, slot) => total + slot.value, 0);
  }

  raceData() {
    return RACE_DATA[this.race];
  }

  hairGraphics() {
    return this.raceData().hair[this.female ? 'female' : 'male'];
  }

  hairLabels() {
    return this.raceData().hairLabels[this.female ? 'female' : 'male'];
  }

  facialGraphics() {
    if (this.female || !this.raceData().facial) return null;
    return this.raceData().facial;
  }

  facialLabels() {
    if (this.female || !this.raceData().facial) return null;
    return this.raceData().facialLabels;
  }

  hairGraphic() {
    return this.hairGraphics()[this.hairStyle] || 0;
  }

  facialGraphic() {
    const graphics = this.facialGraphics();
    return graphics ? graphics[this.facialStyle] || 0 : 0;
  }

  label(id, fallback) {
    if (id) {
      const text = this.game.cliloc?.(id);
      if (text && !/^\d+$/.test(String(text))) return text;
    }
    return fallback;
  }

  async loadProfessions() {
    if (!professionSourcePromise) {
      professionSourcePromise = (async () => {
        let list = [];
        try {
          const res = await fetch(this.assets.url('/api/professions'));
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) list = data;
          }
        } catch {
          list = [];
        }
        const valid = list.filter((item) => item && item.name && item.stats && Array.isArray(item.skills));
        return valid.length ? valid : FALLBACK_PROFESSIONS;
      })();
    }
    const source = await professionSourcePromise;
    const advanced = {
      name: 'Advanced',
      trueName: 'advanced',
      descriptionIndex: -1,
      advanced: true,
      stats: this.version >= CV_70160 ? { str: 60, dex: 15, int: 15 } : { str: 60, dex: 10, int: 10 },
      skills: [],
    };
    return [advanced, ...source.map((item) => ({ ...item }))];
  }

  async open() {
    try {
      await this.assets.loadTileData?.();
    } catch {
      /* preview falls back to the item graphics if tiledata is unavailable */
    }
    this.professions = await this.loadProfessions();
    this.ui.showModal('Create Character', this.buildBody(), null, true, () => this.cleanup(), {
      wide: true,
      customFooter: true,
    });
    this.initControls();
    this.selectDefaultProfession();
    this.renderAppearance();
    this.renderStats();
    this.renderSkills();
    this.renderCity();
    this.renderTotals();
    this.renderPreview();
    setTimeout(() => this.nameInput?.focus(), 20);
  }

  cleanup() {
    this.previewToken++;
  }

  buildBody() {
    const body = document.createElement('div');
    body.className = 'ccBody';
    body.innerHTML = `
      <div class="ccMain">
        <div class="ccPreviewPane">
          <div class="ccPreviewFrame"><canvas id="ccPreview" width="220" height="260"></canvas></div>
          <button type="button" id="ccRandomize" class="ccSmall">Randomize</button>
        </div>
        <div class="ccIdentity">
          <label class="ccField"><span>Name</span><input id="ccName" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Character name"></label>
          <div class="ccGrid2">
            <label class="ccField"><span>Race</span><select id="ccRace"></select></label>
            <label class="ccField"><span>Gender</span><select id="ccGender"><option value="0">Male</option><option value="1">Female</option></select></label>
          </div>
          <label class="ccField"><span>Hair style</span><select id="ccHair"></select></label>
          <label class="ccField" id="ccFacialField"><span>Facial hair</span><select id="ccFacial"></select></label>
          <div class="ccColors">
            <div class="ccColorGroup"><span>Skin tone</span><div class="ccSwatches" id="ccSkin"></div></div>
            <div class="ccColorGroup"><span>Hair color</span><div class="ccSwatches" id="ccHairColor"></div></div>
            <div class="ccColorGroup"><span id="ccShirtLabel">Shirt color</span><div class="ccSwatches" id="ccShirt"></div></div>
            <div class="ccColorGroup" id="ccPantsGroup"><span>Pants color</span><div class="ccSwatches" id="ccPants"></div></div>
            <div class="ccColorGroup" id="ccBeardGroup"><span>Facial hair color</span><div class="ccSwatches" id="ccBeard"></div></div>
          </div>
        </div>
      </div>
      <div class="ccLower">
        <div class="ccPanel">
          <div class="ccPanelTitle"><span>Profession</span></div>
          <select id="ccProfession"></select>
          <div class="ccHint">Pick a starting template, or Advanced to fine-tune everything.</div>
          <div class="ccPanelTitle ccCityTitle"><span>Starting city</span></div>
          <select id="ccCity"></select>
        </div>
        <div class="ccPanel">
          <div class="ccPanelTitle"><span>Attributes</span><span id="ccStatTotal"></span></div>
          <div class="ccStats" id="ccStats"></div>
        </div>
        <div class="ccPanel ccSkillsPanel">
          <div class="ccPanelTitle"><span>Skills</span><span id="ccSkillTotal"></span></div>
          <div class="ccSkills" id="ccSkills"></div>
        </div>
      </div>
      <div class="ccError" id="ccError"></div>
      <div class="ccButtons">
        <button type="button" id="ccCancel">Cancel</button>
        <button type="button" id="ccCreate">Create Character</button>
      </div>`;
    return body;
  }

  initControls() {
    const $ = (id) => document.getElementById(id);
    this.nameInput = $('ccName');
    this.raceInput = $('ccRace');
    this.genderInput = $('ccGender');
    this.hairInput = $('ccHair');
    this.facialInput = $('ccFacial');
    this.facialField = $('ccFacialField');
    this.beardGroup = $('ccBeardGroup');
    this.pantsGroup = $('ccPantsGroup');
    this.shirtLabel = $('ccShirtLabel');
    this.skinGrid = $('ccSkin');
    this.hairGrid = $('ccHairColor');
    this.shirtGrid = $('ccShirt');
    this.pantsGrid = $('ccPants');
    this.beardGrid = $('ccBeard');
    this.professionInput = $('ccProfession');
    this.cityInput = $('ccCity');
    this.statsBox = $('ccStats');
    this.skillsBox = $('ccSkills');
    this.statTotal = $('ccStatTotal');
    this.skillTotal = $('ccSkillTotal');
    this.errorBox = $('ccError');
    this.canvas = $('ccPreview');
    this.ctx = this.canvas?.getContext('2d') || null;

    for (const [value, name] of Object.entries(RACE_NAMES)) {
      if (Number(value) === 2 && !this.allowElf) continue;
      if (Number(value) === 3 && !this.allowGargoyle) continue;
      this.raceInput.appendChild(option(value, name));
    }
    this.raceInput.value = String(this.race);
    this.genderInput.value = this.female ? '1' : '0';
    this.hairInput.addEventListener('change', () => {
      this.hairStyle = Number(this.hairInput.value) || 0;
      this.renderPreview();
    });
    this.facialInput.addEventListener('change', () => {
      this.facialStyle = Number(this.facialInput.value) || 0;
      this.renderPreview();
    });
    this.raceInput.addEventListener('change', () => this.onRaceChanged());
    this.genderInput.addEventListener('change', () => this.onGenderChanged());
    $('ccRandomize').addEventListener('click', () => this.randomize());
    $('ccCancel').addEventListener('click', () => {
      this.cleanup();
      this.ui.hideModal();
    });
    $('ccCreate').addEventListener('click', () => this.submit());
    this.professionInput.addEventListener('change', () => this.onProfessionChanged());
    this.skinGrid.addEventListener('click', (e) => this.onSwatch(e, 'skin'));
    this.hairGrid.addEventListener('click', (e) => this.onSwatch(e, 'hair'));
    this.shirtGrid.addEventListener('click', (e) => this.onSwatch(e, 'shirt'));
    this.pantsGrid.addEventListener('click', (e) => this.onSwatch(e, 'pants'));
    this.beardGrid.addEventListener('click', (e) => this.onSwatch(e, 'beard'));
    this.renderCity();
  }

  selectDefaultProfession() {
    this.professionInput.innerHTML = '';
    this.professions.forEach((profession, index) => {
      this.professionInput.appendChild(option(index, this.professionLabel(profession)));
    });
    let index = this.professions.findIndex((item) => !item.advanced && /warrior/i.test(item.name || ''));
    if (index < 0) index = this.professions.findIndex((item) => !item.advanced);
    if (index < 0) index = 0;
    this.professionInput.value = String(index);
    this.applyProfession(this.professions[index], false);
  }

  professionLabel(profession) {
    if (profession.advanced) return 'Advanced';
    return this.label(profession.nameId, profession.name || profession.trueName || 'Profession');
  }

  onProfessionChanged() {
    const profession = this.professions[Number(this.professionInput.value)];
    if (profession) this.applyProfession(profession, true);
  }

  applyProfession(profession, rerender = true) {
    this.profession = profession;
    if (profession.advanced) {
      this.professionValue = 255;
      this.resetAdvanced();
      if (rerender) {
        this.renderStats();
        this.renderSkills();
        this.renderTotals();
      }
      return;
    }

    this.professionValue = profession.descriptionIndex >= 0 ? profession.descriptionIndex & 0xff : 255;
    const stats = profession.stats || {};
    this.stats = {
      str: clamp(Number(stats.str) || 10, 10, 60),
      dex: clamp(Number(stats.dex) || 10, 10, 60),
      int: clamp(Number(stats.int) || 10, 10, 60),
    };
    this.statBudget = sum(this.stats);

    const used = new Set();
    const slots = [];
    for (let i = 0; i < this.skillCount; i++) {
      const entry = profession.skills?.[i];
      let index = entry ? Number(entry.index) : -1;
      if (!Number.isFinite(index) || index < 0 || used.has(index)) index = -1;
      if (index >= 0) used.add(index);
      slots.push({ index, value: entry ? clamp(Number(entry.value) || 0, 0, 50) : 0 });
    }
    for (const slot of slots) {
      if (slot.index >= 0) continue;
      const candidate = this.skillList.find((skill) => !used.has(Number(skill.index)) && Number(skill.index) < 58);
      if (candidate) {
        slot.index = Number(candidate.index);
        used.add(slot.index);
      }
    }
    this.skillSlots = slots;
    this.skillBudget = slots.reduce((total, slot) => total + slot.value, 0);

    if (rerender) {
      this.renderStats();
      this.renderSkills();
      this.renderTotals();
    }
  }

  onRaceChanged() {
    this.race = Number(this.raceInput.value) || 1;
    this.resetAppearance();
    this.renderAppearance();
    this.renderPreview();
  }

  onGenderChanged() {
    this.female = this.genderInput.value === '1';
    this.resetAppearance();
    this.renderAppearance();
    this.renderPreview();
  }

  renderAppearance() {
    const data = this.raceData();
    const hairGraphics = this.hairGraphics();
    const hairLabels = this.hairLabels();
    this.hairInput.innerHTML = '';
    hairGraphics.forEach((graphic, index) => {
      const fallback = index === 0 ? 'None' : `Style ${index}`;
      this.hairInput.appendChild(option(index, this.label(hairLabels?.[index], fallback)));
    });
    this.hairInput.value = String(Math.min(this.hairStyle, hairGraphics.length - 1));

    const facialGraphics = this.facialGraphics();
    this.facialField.style.display = facialGraphics ? '' : 'none';
    this.beardGroup.style.display = facialGraphics ? '' : 'none';
    this.facialInput.innerHTML = '';
    if (facialGraphics) {
      const labels = this.facialLabels();
      facialGraphics.forEach((graphic, index) => {
        const fallback = index === 0 ? 'None' : `Style ${index}`;
        this.facialInput.appendChild(option(index, this.label(labels?.[index], fallback)));
      });
      this.facialStyle = Math.min(this.facialStyle, facialGraphics.length - 1);
      this.facialInput.value = String(this.facialStyle);
    } else {
      this.facialStyle = 0;
    }

    this.pantsGroup.style.display = data.clothes[this.female ? 'female' : 'male'].robe ? 'none' : '';
    this.shirtLabel.textContent = data.clothes[this.female ? 'female' : 'male'].robe ? 'Robe color' : 'Shirt color';

    this.renderSwatches(this.skinGrid, data.skin.map((hue) => hue + 1), this.skinHue);
    this.renderSwatches(this.hairGrid, data.hairColors.map((hue) => hue + 1), this.hairHue);
    this.renderSwatches(this.shirtGrid, this.shirtHues, this.shirtHue);
    this.renderSwatches(this.pantsGrid, this.shirtHues, this.pantsHue);
    this.renderSwatches(this.beardGrid, data.hairColors.map((hue) => hue + 1), this.beardHue);
  }

  renderSwatches(container, hues, selected) {
    if (!container) return;
    container.innerHTML = '';
    for (const hue of hues) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ccSwatch';
      button.dataset.hue = String(hue);
      button.title = `Hue ${hue}`;
      button.style.background = this.ui.hueColor(hue);
      if (hue === selected) button.classList.add('selected');
      container.appendChild(button);
    }
  }

  onSwatch(event, target) {
    const button = event.target.closest?.('.ccSwatch');
    if (!button) return;
    const hue = Number(button.dataset.hue);
    const grid = {
      skin: this.skinGrid,
      hair: this.hairGrid,
      shirt: this.shirtGrid,
      pants: this.pantsGrid,
      beard: this.beardGrid,
    }[target];
    if (target === 'skin') this.skinHue = hue;
    else if (target === 'hair') this.hairHue = hue;
    else if (target === 'shirt') this.shirtHue = hue;
    else if (target === 'pants') this.pantsHue = hue;
    else if (target === 'beard') this.beardHue = hue;
    for (const child of grid.children) child.classList.toggle('selected', child === button);
    this.renderPreview();
  }

  randomize() {
    const data = this.raceData();
    const hairGraphics = this.hairGraphics();
    const facialGraphics = this.facialGraphics();
    this.hairStyle = randomIndex(hairGraphics.length);
    if (facialGraphics) this.facialStyle = randomIndex(facialGraphics.length);
    this.skinHue = data.skin[randomIndex(data.skin.length)] + 1;
    this.hairHue = data.hairColors[randomIndex(data.hairColors.length)] + 1;
    this.beardHue = data.hairColors[randomIndex(data.hairColors.length)] + 1;
    this.shirtHue = this.shirtHues[randomIndex(this.shirtHues.length)];
    this.pantsHue = this.shirtHues[randomIndex(this.shirtHues.length)];
    this.hairInput.value = String(this.hairStyle);
    if (facialGraphics) this.facialInput.value = String(this.facialStyle);
    this.renderSwatches(this.skinGrid, data.skin.map((hue) => hue + 1), this.skinHue);
    this.renderSwatches(this.hairGrid, data.hairColors.map((hue) => hue + 1), this.hairHue);
    this.renderSwatches(this.shirtGrid, this.shirtHues, this.shirtHue);
    this.renderSwatches(this.pantsGrid, this.shirtHues, this.pantsHue);
    this.renderSwatches(this.beardGrid, data.hairColors.map((hue) => hue + 1), this.beardHue);
    this.renderPreview();
  }

  renderStats() {
    if (!this.statsBox) return;
    this.statsBox.innerHTML = '';
    this.statInputs = {};
    this.statValues = {};
    const rows = [
      ['str', 'Strength'],
      ['dex', 'Dexterity'],
      ['int', 'Intelligence'],
    ];
    for (const [key, label] of rows) {
      const row = document.createElement('div');
      row.className = 'ccSliderRow';
      const name = document.createElement('span');
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '10';
      input.max = '60';
      input.step = '1';
      input.value = String(this.stats[key]);
      input.dataset.stat = key;
      const value = document.createElement('span');
      value.className = 'ccSliderValue';
      value.textContent = String(this.stats[key]);
      input.addEventListener('input', () => this.onStatInput(key, Number(input.value)));
      row.append(name, input, value);
      this.statsBox.appendChild(row);
      this.statInputs[key] = input;
      this.statValues[key] = value;
    }
  }

  onStatInput(key, value) {
    applyBudgetChange(this.stats, key, value, ['str', 'dex', 'int'], 10, 60);
    this.syncStats();
  }

  syncStats() {
    if (!this.statInputs) return;
    for (const key of ['str', 'dex', 'int']) {
      if (this.statInputs[key]) this.statInputs[key].value = String(this.stats[key]);
      if (this.statValues[key]) this.statValues[key].textContent = String(this.stats[key]);
    }
    this.updateTotals();
  }

  renderSkills() {
    if (!this.skillsBox) return;
    this.skillsBox.innerHTML = '';
    this.skillInputs = [];
    this.skillSelects = [];
    this.skillValueLabels = [];
    for (let slot = 0; slot < this.skillCount; slot++) {
      const state = this.skillSlots[slot] || { index: -1, value: 0 };
      const row = document.createElement('div');
      row.className = 'ccSkillRow';
      const select = document.createElement('select');
      select.dataset.slot = String(slot);
      select.appendChild(option(-1, 'Choose a skill'));
      for (const skill of this.skillList) {
        select.appendChild(option(skill.index, skill.name || `Skill ${skill.index}`));
      }
      select.value = String(state.index);
      select.addEventListener('change', () => {
        state.index = Number(select.value);
      });
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '50';
      input.step = '1';
      input.value = String(state.value);
      input.dataset.slot = String(slot);
      const value = document.createElement('span');
      value.className = 'ccSliderValue';
      value.textContent = String(state.value);
      input.addEventListener('input', () => this.onSkillInput(slot, Number(input.value)));
      row.append(select, input, value);
      this.skillsBox.appendChild(row);
      this.skillSelects.push(select);
      this.skillInputs.push(input);
      this.skillValueLabels.push(value);
    }
  }

  onSkillInput(slot, value) {
    const keys = this.skillSlots.map((_, index) => index);
    const values = {};
    this.skillSlots.forEach((item, index) => (values[index] = item.value));
    applyBudgetChange(values, slot, value, keys, 0, 50);
    this.skillSlots.forEach((item, index) => (item.value = values[index]));
    this.syncSkills();
  }

  syncSkills() {
    if (!this.skillInputs) return;
    this.skillSlots.forEach((slot, index) => {
      if (this.skillInputs[index]) this.skillInputs[index].value = String(slot.value);
      if (this.skillValueLabels[index]) this.skillValueLabels[index].textContent = String(slot.value);
    });
    this.updateTotals();
  }

  renderCity() {
    if (!this.cityInput) return;
    this.cityInput.innerHTML = '';
    for (const city of this.cities) {
      this.cityInput.appendChild(option(city.index, city.name || `City ${city.index}`));
    }
    if (!this.cities.length) this.cityInput.appendChild(option(0, 'Britain'));
  }

  updateTotals() {
    if (this.statTotal) {
      const total = sum(this.stats);
      this.statTotal.textContent = `${total} / ${this.statBudget}`;
    }
    if (this.skillTotal) {
      const total = this.skillSlots.reduce((sumValue, slot) => sumValue + slot.value, 0);
      this.skillTotal.textContent = `${total} / ${this.skillBudget}`;
    }
  }

  renderTotals() {
    this.updateTotals();
  }

  bodyGraphic() {
    return this.raceData().body[this.female ? 'female' : 'male'];
  }

  animId(graphic) {
    if (!graphic) return 0;
    const id = this.assets.staticAnimId?.(graphic);
    return id || graphic;
  }

  previewLayers() {
    const clothes = this.raceData().clothes[this.female ? 'female' : 'male'];
    const layers = [{ graphic: this.bodyGraphic(), hue: this.skinHue, equip: false }];
    if (clothes.robe) {
      layers.push({ graphic: clothes.robe, hue: this.shirtHue, equip: true });
    } else {
      if (clothes.shirt) layers.push({ graphic: clothes.shirt, hue: this.shirtHue, equip: true });
      if (clothes.pants) layers.push({ graphic: clothes.pants, hue: this.pantsHue, equip: true });
      if (clothes.skirt) layers.push({ graphic: clothes.skirt, hue: this.pantsHue, equip: true });
      if (clothes.shoes) layers.push({ graphic: clothes.shoes, hue: 0x0384, equip: true });
    }
    const hair = this.hairGraphic();
    if (hair) layers.push({ graphic: hair, hue: this.hairHue, equip: true });
    const facial = this.facialGraphic();
    if (facial) layers.push({ graphic: facial, hue: this.beardHue, equip: true });
    return layers;
  }

  async loadAnim(graphic, hue, equip) {
    const id = equip ? this.animId(graphic) : graphic;
    if (!id) return null;
    const key = `${id}|${hue}|${equip ? 1 : 0}`;
    if (this.animCache.has(key)) return this.animCache.get(key);
    const params = `hue=${hue}${equip ? '&equip=1' : ''}`;
    const promise = (async () => {
      const metaUrl = this.assets.url(`/api/anim/${id}/4/0?${params}`);
      const imageUrl = this.assets.url(`/api/anim/${id}/4/0.png?${params}`);
      try {
        const [meta, img] = await Promise.all([
          fetch(metaUrl).then((res) => (res.ok ? res.json() : null)),
          this.loadImage(imageUrl),
        ]);
        if (!meta || !img || !meta.frames?.length) return null;
        return { meta, img };
      } catch {
        return null;
      }
    })();
    this.animCache.set(key, promise);
    return promise;
  }

  loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async renderPreview() {
    if (!this.ctx || !this.canvas) return;
    const token = ++this.previewToken;
    const layers = this.previewLayers();
    const frames = await Promise.all(layers.map((layer) => this.loadAnim(layer.graphic, layer.hue, layer.equip)));
    if (token !== this.previewToken) return;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);

    const anchorX = width / 2;
    const anchorY = height - 16;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(anchorX, anchorY, this.race === 3 ? 76 : 34, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const scale = this.race === 3 ? 2 : 3;
    let drawn = 0;
    for (const data of frames) {
      if (!data) continue;
      const frame = data.meta.frames[0];
      if (!frame) continue;
      const drawX = anchorX - frame.cx * scale;
      const drawY = anchorY - (frame.h + frame.cy) * scale;
      ctx.drawImage(
        data.img,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
        drawX,
        drawY,
        frame.w * scale,
        frame.h * scale
      );
      drawn++;
    }
    if (!drawn) {
      ctx.save();
      ctx.fillStyle = 'rgba(232,224,200,0.55)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No preview art available', width / 2, height / 2);
      ctx.restore();
    }
  }

  validate() {
    const name = this.nameInput.value;
    const trimmed = name.trim();
    if (trimmed.length < 2) return 'Character names must be at least 2 characters.';
    if (trimmed.length > 16) return 'Character names cannot be longer than 16 characters.';
    if (trimmed !== name) return 'Character names cannot start or end with spaces.';
    if (!/^[A-Za-z0-9][A-Za-z0-9' .-]*$/.test(trimmed)) {
      return 'Use only letters, numbers, spaces, apostrophes, periods and dashes.';
    }
    if (/^(gm|admin|seer|counselor)\b/i.test(trimmed)) {
      return 'That name is reserved. Please choose another.';
    }
    if (this.race === 2 && !this.allowElf) return 'This shard does not support the elven race.';
    if (this.race === 3 && !this.allowGargoyle) return 'This client version does not support gargoyles.';

    const statTotal = sum(this.stats);
    if (statTotal !== this.statBudget) {
      return `Attributes must total ${this.statBudget} (currently ${statTotal}).`;
    }

    const indices = this.skillSlots.map((slot) => slot.index);
    if (indices.some((index) => index < 0)) return 'Choose a skill for every skill slot.';
    if (new Set(indices).size !== indices.length) return 'Choose a different skill for each slot.';
    const skillTotal = this.skillSlots.reduce((total, slot) => total + slot.value, 0);
    if (skillTotal !== this.skillBudget) {
      return `Skills must total ${this.skillBudget} (currently ${skillTotal}).`;
    }
    return null;
  }

  submit() {
    const error = this.validate();
    if (error) {
      this.showError(error);
      return;
    }
    this.errorBox.textContent = '';

    const name = this.nameInput.value.trim();
    const characters = this.world.login?.characters || [];
    let slot = characters.findIndex((value) => !value);
    if (slot < 0) slot = characters.length;
    const hair = this.hairGraphic();
    const facial = this.facialGraphic();

    this.world.login.step = 'creating';
    this.world.login.pendingCreate = true;
    this.world.login.pendingCharacterName = name;
    this.ui.setLoginStatus(`Creating ${name}...`);
    this.world.socket.out.createCharacter({
      name,
      female: this.female,
      race: this.race,
      strength: this.stats.str,
      dexterity: this.stats.dex,
      intelligence: this.stats.int,
      skills: this.skillSlots.map((skill) => [skill.index, skill.value]),
      cityIndex: Number(this.cityInput?.value) || 0,
      slot,
      profession: this.professionValue,
      hue: this.skinHue,
      hair: [hair, hair ? this.hairHue : 0],
      beard: [facial, facial ? this.beardHue : 0],
      shirtHue: this.shirtHue,
      pantsHue: this.pantsHue,
    });
    this.cleanup();
    this.ui.hideModal();
  }

  showError(message) {
    if (!this.errorBox) return;
    this.errorBox.textContent = message;
  }
}
