const STORAGE_KEY = 'legionuo.options.v1';

const DEFAULTS = {
  alwaysRun: false,
  showNames: true,
  showHealthBars: true,
  showSpeech: true,
  lighting: true,
  weather: true,
  questArrow: true,
  waypoints: true,
  audioEnabled: typeof location !== 'undefined' && new URLSearchParams(location.search).has('audio'),
  audioVolume: 60,
  footsteps: true,
  optionsTab: 'general',
  optionsX: null,
  optionsY: null,
};

const BOOLEAN_KEYS = [
  'alwaysRun',
  'showNames',
  'showHealthBars',
  'showSpeech',
  'lighting',
  'weather',
  'questArrow',
  'waypoints',
  'audioEnabled',
  'footsteps',
];

const TABS = ['general', 'display', 'audio'];

class SettingsStore {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (const key of Object.keys(DEFAULTS)) {
          if (key in saved) this.values[key] = saved[key];
        }
      }
    } catch {
      /* ignore corrupt settings */
    }
    this.sanitize();
  }

  sanitize() {
    for (const key of BOOLEAN_KEYS) this.values[key] = !!this.values[key];
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
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
