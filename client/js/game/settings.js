const STORAGE_KEY = 'legionuo.options.v2';
const LEGACY_KEY = 'legionuo.options.v1';

const DEFAULTS = {
  alwaysRun: true,
  autoOpenDoors: true,
  showNames: true,
  showHealthBars: true,
  dragSelectHealthBars: true,
  showSpeech: true,
  lighting: true,
  weather: true,
  dayNight: true,
  questArrow: true,
  waypoints: true,
  mobileContainerView: true,
  transparentForegroundStatics: false,
  radarOverlay: false,
  radarOverlayTransparency: 30,
  radarOverlaySize: 220,
  radarOverlayX: 1,
  radarOverlayY: 0,
  audioEnabled: typeof location !== 'undefined' && new URLSearchParams(location.search).has('audio'),
  audioVolume: 60,
  footsteps: true,
  gumpFont: 3,
  frameLimit: 0,
  gameZoom: 1,
  keyJournal: 'KeyJ',
  keyHelp: 'F1',
  keyWar: 'Alt+KeyW',
  keyLastTarget: 'KeyL',
  keyAllNames: 'KeyN',
  optionsTab: 'general',
  optionsX: null,
  optionsY: null,
  joystickX: null,
  joystickY: null,
};

const BOOLEAN_KEYS = [
  'alwaysRun',
  'autoOpenDoors',
  'showNames',
  'showHealthBars',
  'dragSelectHealthBars',
  'showSpeech',
  'lighting',
  'weather',
  'dayNight',
  'questArrow',
  'waypoints',
  'mobileContainerView',
  'transparentForegroundStatics',
  'radarOverlay',
  'audioEnabled',
  'footsteps',
];

const KEY_KEYS = ['keyJournal', 'keyHelp', 'keyWar', 'keyLastTarget', 'keyAllNames'];

const TABS = ['general', 'display', 'overlay', 'audio', 'keys'];

function minGameZoom() {
  if (typeof window === 'undefined') return 0.5;
  try {
    return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 700 ? 0.8 : 0.5;
  } catch {
    return 0.5;
  }
}

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
    const frameLimit = Number(this.values.frameLimit);
    this.values.frameLimit = Number.isFinite(frameLimit)
      ? Math.max(0, Math.min(240, Math.round(frameLimit)))
      : DEFAULTS.frameLimit;
    const gameZoom = Number(this.values.gameZoom);
    this.values.gameZoom = Number.isFinite(gameZoom)
      ? Math.round(Math.max(minGameZoom(), Math.min(2, gameZoom)) * 100) / 100
      : DEFAULTS.gameZoom;
    const overlayTransparency = Number(this.values.radarOverlayTransparency);
    this.values.radarOverlayTransparency = Number.isFinite(overlayTransparency)
      ? Math.max(0, Math.min(100, Math.round(overlayTransparency)))
      : DEFAULTS.radarOverlayTransparency;
    const overlaySize = Number(this.values.radarOverlaySize);
    this.values.radarOverlaySize = Number.isFinite(overlaySize)
      ? Math.max(64, Math.min(600, Math.round(overlaySize)))
      : DEFAULTS.radarOverlaySize;
    for (const key of ['radarOverlayX', 'radarOverlayY']) {
      const value = Number(this.values[key]);
      this.values[key] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULTS[key];
    }
    if (!TABS.includes(this.values.optionsTab)) this.values.optionsTab = DEFAULTS.optionsTab;
    for (const key of ['optionsX', 'optionsY']) {
      const value = this.values[key];
      this.values[key] = value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    }
    for (const key of ['joystickX', 'joystickY']) {
      const value = Number(this.values[key]);
      this.values[key] =
        this.values[key] == null || this.values[key] === ''
          ? null
          : Number.isFinite(value)
            ? Math.max(0, Math.min(1, value))
            : null;
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
