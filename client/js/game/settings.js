const STORAGE_KEY = 'legionuo.options.v2';
const LEGACY_KEY = 'legionuo.options.v1';

const DEFAULTS = {
  alwaysRun: false,
  showNames: true,
  showHealthBars: true,
  dragSelectHealthBars: true,
  showSpeech: true,
  lighting: true,
  weather: true,
  dayNight: true,
  questArrow: true,
  waypoints: true,
  audioEnabled: typeof location !== 'undefined' && new URLSearchParams(location.search).has('audio'),
  audioVolume: 60,
  footsteps: true,
  gumpFont: 3,
  keyJournal: 'KeyJ',
  keyHelp: 'F1',
  keyWar: 'Alt+KeyW',
  keyLastTarget: 'KeyL',
  keyAllNames: 'KeyN',
  optionsTab: 'general',
  optionsX: null,
  optionsY: null,
};

const BOOLEAN_KEYS = [
  'alwaysRun',
  'showNames',
  'showHealthBars',
  'dragSelectHealthBars',
  'showSpeech',
  'lighting',
  'weather',
  'dayNight',
  'questArrow',
  'waypoints',
  'audioEnabled',
  'footsteps',
];

const KEY_KEYS = ['keyJournal', 'keyHelp', 'keyWar', 'keyLastTarget', 'keyAllNames'];

const TABS = ['general', 'display', 'audio', 'keys'];

class SettingsStore {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    this.account = '';
    this.load();
  }

  storageKey() {
    return this.account ? `${STORAGE_KEY}.${this.account}` : STORAGE_KEY;
  }

  load(key = this.storageKey()) {
    this.values = { ...DEFAULTS };
    try {
      let saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!saved && key === STORAGE_KEY) saved = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (const name of Object.keys(DEFAULTS)) {
          if (name in saved) this.values[name] = saved[name];
        }
      }
    } catch {
      /* ignore corrupt settings */
    }
    this.sanitize();
  }

  setAccount(account) {
    const next = (account || '').trim().toLowerCase();
    if (next === this.account) return;
    this.account = next;
    this.load();
    for (const listener of this.listeners) listener('account', next);
  }

  sanitize() {
    for (const key of BOOLEAN_KEYS) this.values[key] = !!this.values[key];
    for (const key of KEY_KEYS) {
      if (!this.values[key] || typeof this.values[key] !== 'string') this.values[key] = DEFAULTS[key];
    }
    const font = Number(this.values.gumpFont);
    this.values.gumpFont = Math.max(0, Math.min(9, Number.isFinite(font) ? Math.round(font) : 3));
    const volume = Number(this.values.audioVolume);
    this.values.audioVolume = Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : DEFAULTS.audioVolume));
    if (!TABS.includes(this.values.optionsTab)) this.values.optionsTab = DEFAULTS.optionsTab;
    for (const key of ['optionsX', 'optionsY']) {
      const value = this.values[key];
      this.values[key] = value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value, persist = true) {
    if (this.values[key] === value) return value;
    this.values[key] = value;
    if (persist) this.save();
    for (const listener of this.listeners) listener(key, value);
    return value;
  }

  toggle(key) {
    return this.set(key, !this.values[key]);
  }

  save() {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.values));
    } catch {
      /* ignore quota errors */
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const settings = new SettingsStore();
export const OPTION_KEYS = KEY_KEYS;
