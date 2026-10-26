import { hasUoHtmlMarkup, uoHtmlFragment } from '../game/html.js';
import { clamp, isMobileLayout, viewportSize } from '../util/ui.js';

const $ = (id) => document.getElementById(id);

const FILTERS = ['all', 'system', 'speech', 'party', 'guild', 'spells', 'chat', 'damage'];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const LEGACY_BACKGROUNDS = {
  dark: '#120f0a',
  dim: '#201c13',
  medium: '#342e22',
  light: '#4c4434',
};

const DEFAULTS = {
  x: 10,
  y: null,
  width: 560,
  height: 176,
  timestamps: false,
  opacity: 0.9,
  background: LEGACY_BACKGROUNDS.medium,
  fontSize: 12,
  maxLines: 500,
  filter: 'all',
  mode: 'say',
  language: 'ENU',
  open: true,
  ignore: [],
};

const STORAGE_BASE = 'legionuo.journal.v1';

const OVERLAY_LIFETIME = 5000;
const OVERLAY_FADE = 400;
const OVERLAY_LIMIT = 6;

function pad(value) {
  return String(value).padStart(2, '0');
}

function timeLabel(timestamp) {
  const d = new Date(timestamp);
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

export class Journal {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.world = ui.world;
    this.entries = [];
    this.nodes = new Map();
    this.nextId = 0;
    this.account = '';
    this.drag = null;
    this.resize = null;

    this.root = $('journalPanel');
    this.log = $('journal');
    this.overlay = $('systemMessages');
    this.overlayItems = new Map();
    this.tabs = $('journalTabs');
    this.options = $('journalOptions');
    this.title = $('journalTitle');
    this.modeSelect = $('chatMode');

    this.settings = this.loadSettings(STORAGE_BASE);
    this.applySettings();
    this.bind();
  }

  /* ----------------------------- storage ----------------------------- */

  storageKey() {
    return this.account ? `${STORAGE_BASE}.${this.account.toLowerCase()}` : STORAGE_BASE;
  }

  loadSettings(key) {
    const settings = { ...DEFAULTS, ignore: [] };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && typeof saved === 'object') Object.assign(settings, saved);
    } catch {
      /* ignore corrupt settings */
    }
    if (!Array.isArray(settings.ignore)) settings.ignore = [];
    if (!FILTERS.includes(settings.filter)) settings.filter = 'all';
    if (LEGACY_BACKGROUNDS[settings.background]) {
      settings.background = LEGACY_BACKGROUNDS[settings.background];
    }
    if (!HEX_COLOR.test(settings.background || '')) settings.background = DEFAULTS.background;
    if (settings.y == null) {
      // Leave room for the touch joystick at the lower-right on mobile, so the
      // default journal position does not sit underneath it.
      const bottomGap = isMobileLayout() ? 160 : 14;
      settings.y = Math.max(10, window.innerHeight - settings.height - bottomGap);
    }
    const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    settings.width = clamp(num(settings.width, DEFAULTS.width), 280, window.innerWidth - 8);
    settings.height = clamp(num(settings.height, DEFAULTS.height), 120, window.innerHeight - 8);
    settings.x = clamp(num(settings.x, DEFAULTS.x), 0, Math.max(0, window.innerWidth - 80));
    settings.y = clamp(num(settings.y, DEFAULTS.y ?? 10), 0, Math.max(0, window.innerHeight - 40));
    settings.opacity = clamp(Number(settings.opacity) || DEFAULTS.opacity, 0.2, 1);
    settings.fontSize = clamp(Number(settings.fontSize) || DEFAULTS.fontSize, 9, 20);
    settings.maxLines = clamp(Number(settings.maxLines) || DEFAULTS.maxLines, 50, 5000);
    if (!['say', 'whisper', 'yell', 'emote', 'party', 'guild', 'alliance'].includes(settings.mode)) {
      settings.mode = 'say';
    }
    settings.language = String(settings.language || 'ENU').toUpperCase().slice(0, 3) || 'ENU';
    if (typeof settings.open !== 'boolean') settings.open = DEFAULTS.open;
    return settings;
  }

  save() {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.settings));
    } catch {
      /* ignore quota errors */
    }
  }

  setAccount(account) {
    const next = (account || '').trim();
    if (next === this.account) return;
    this.account = next;
    this.settings = this.loadSettings(this.storageKey());
    this.applySettings();
  }

  /* ----------------------------- entries ----------------------------- */

  classify(msg) {
    if (msg.damage) return 'damage';
    if (msg.textType === 'party') return 'party';
    if (msg.textType === 'guild') return 'guild';
    if (msg.textType === 'chat' || msg.type === 0xb2) return 'chat';
    if (msg.textType === 'spell') return 'spells';
    if (msg.type === 10) return 'spells';
    if (msg.type === 13 || msg.type === 14) return 'guild';
    if (msg.type === 1 || msg.textType === 'system') return 'system';
    if ((msg.name || '').toLowerCase() === 'system') return 'system';
    return 'speech';
  }

  isIgnored(name) {
    const key = (name || '').trim().toLowerCase();
    return !!key && this.settings.ignore.includes(key);
  }

  addMessage(msg) {
    if (msg.cliloc && msg.serial && msg.replace) {
      const key = `${msg.serial >>> 0}|${msg.cliloc}`;
      for (let i = this.entries.length - 1; i >= Math.max(0, this.entries.length - 8); i--) {
        const entry = this.entries[i];
        if (entry.serial !== (msg.serial >>> 0) || entry.cliloc !== msg.cliloc) continue;
        if (Date.now() - entry.timestamp > 3000) break;
        entry.text = msg.text || entry.text;
        entry.timestamp = msg.time || Date.now();
        const node = this.nodes.get(entry.id);
        if (node) {
          const next = this.renderEntry(entry);
          node.replaceWith(next);
          this.nodes.set(entry.id, next);
        }
        return entry;
      }
    }
    const kind = this.classify(msg);
    const color = msg.color || (kind === 'speech' ? this.ui.speechColor(msg.hue) : '');
    return this.addEntry({
      timestamp: msg.time || Date.now(),
      text: msg.text || '',
      name: msg.name || '',
      serial: msg.serial || 0,
      hue: msg.hue || 0,
      font: msg.font || 3,
      type: msg.type ?? 0,
      kind,
      color,
      cliloc: msg.cliloc || 0,
      affix: msg.affix || '',
      overhead: !!msg.overhead,
      translated: !!msg.translated,
      damage: !!msg.damage,
    });
  }

  addSystem(text, color = '#d6b45d') {
    return this.addEntry({
      timestamp: Date.now(),
      text,
      kind: 'system',
      color,
    });
  }

  addDamage(entity, damage) {
    if (!entity || entity !== this.world.player) return;
    const amount = Math.max(0, Math.round(damage));
    if (!amount) return;
    this.addEntry({
      timestamp: Date.now(),
      text: `You take ${amount} damage.`,
      kind: 'damage',
      damage: true,
      color: '#e06050',
    });
  }

  addEntry(entry) {
    const item = {
      id: ++this.nextId,
      timestamp: entry.timestamp || Date.now(),
      text: entry.text || '',
      name: entry.name || '',
      serial: entry.serial >>> 0,
      hue: entry.hue || 0,
      font: entry.font || 3,
      type: entry.type ?? 0,
      kind: entry.kind || 'system',
      color: entry.color || '',
      cliloc: entry.cliloc || 0,
      affix: entry.affix || '',
      overhead: !!entry.overhead,
      translated: !!entry.translated,
      damage: !!entry.damage,
    };
    item.ignored = this.isIgnored(item.name);
    this.entries.push(item);
    const nearBottom = this.isNearBottom();
    const node = this.renderEntry(item);
    this.nodes.set(item.id, node);
    this.log.appendChild(node);
    this.trim();
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
    if (item.kind === 'system') this.showOverlayMessage(item);
    return item;
  }

  showOverlayMessage(item) {
    if (!this.overlay || this.isOpen()) return;
    if ($('hud')?.classList.contains('hidden')) return;
    if (item.ignored) return;

    const node = document.createElement('div');
    node.className = 'systemMessage';
    if (item.color) node.style.color = item.color;
    if (hasUoHtmlMarkup(item.text)) {
      node.append(uoHtmlFragment(item.text, { defaultColor: item.color || undefined }));
    } else {
      node.textContent = item.text;
    }

    this.overlay.appendChild(node);
    const record = { node, timer: 0 };
    this.overlayItems.set(item.id, record);

    while (this.overlayItems.size > OVERLAY_LIMIT) {
      const oldest = this.overlayItems.keys().next().value;
      this.removeOverlayMessage(oldest, true);
    }

    record.timer = setTimeout(() => this.removeOverlayMessage(item.id), OVERLAY_LIFETIME);
  }

  removeOverlayMessage(id, immediate = false) {
    const record = this.overlayItems.get(id);
    if (!record) return;
    this.overlayItems.delete(id);
    clearTimeout(record.timer);
    if (immediate) {
      record.node.remove();
      return;
    }
    record.node.classList.add('leaving');
    setTimeout(() => record.node.remove(), OVERLAY_FADE);
  }

  clearOverlay() {
    for (const record of this.overlayItems.values()) clearTimeout(record.timer);
    this.overlayItems.clear();
    this.overlay?.replaceChildren();
  }

  renderEntry(item) {
    const div = document.createElement('div');
    div.className = `msg ${item.kind}${item.ignored ? ' ignored' : ''}`;
    div.dataset.id = String(item.id);
    if (item.color) div.style.color = item.color;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${timeLabel(item.timestamp)} `;
    div.appendChild(time);

    if (item.name && item.name.toLowerCase() !== 'system') {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${item.name}: `;
      div.appendChild(who);
    }

    if (hasUoHtmlMarkup(item.text)) {
      div.append(uoHtmlFragment(item.text, { defaultColor: item.color || undefined }));
      div.addEventListener('click', (event) => {
        const link = event.target.closest?.('[data-href]');
        if (!link) return;
        const href = link.dataset.href || '';
        if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
      });
    } else {
      div.appendChild(document.createTextNode(item.text));
    }

    this.applyVisibility(div, item);
    return div;
  }

  isVisible(item) {
    if (item.ignored) return false;
    return this.settings.filter === 'all' || item.kind === this.settings.filter;
  }

  applyVisibility(node, item) {
    node.classList.toggle('hidden', !this.isVisible(item));
  }

  isNearBottom() {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
  }

  trim() {
    while (this.entries.length > this.settings.maxLines) {
      const removed = this.entries.shift();
      const node = this.nodes.get(removed.id);
      node?.remove();
      this.nodes.delete(removed.id);
    }
  }

  clear() {
    this.entries = [];
    this.nodes.clear();
    this.log.replaceChildren();
    this.clearOverlay();
  }

  rerender() {
    const scroll = this.log.scrollTop;
    const nearBottom = this.isNearBottom();
    this.nodes.clear();
    this.log.replaceChildren();
    for (const entry of this.entries) {
      const node = this.renderEntry(entry);
      this.nodes.set(entry.id, node);
      this.log.appendChild(node);
    }
    this.log.scrollTop = nearBottom ? this.log.scrollHeight : scroll;
  }

  setFilter(filter) {
    if (!FILTERS.includes(filter)) return;
    this.settings.filter = filter;
    for (const tab of this.tabs?.querySelectorAll('[data-filter]') || []) {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    }
    for (const entry of this.entries) {
      const node = this.nodes.get(entry.id);
      if (node) this.applyVisibility(node, entry);
    }
    this.save();
  }

  refreshIgnored() {
    for (const entry of this.entries) {
      entry.ignored = this.isIgnored(entry.name);
      const node = this.nodes.get(entry.id);
      if (!node) continue;
      node.classList.toggle('ignored', entry.ignored);
      this.applyVisibility(node, entry);
    }
  }

  addIgnore(name) {
    const key = (name || '').trim().toLowerCase();
    if (!key) return false;
    if (!this.settings.ignore.includes(key)) this.settings.ignore.push(key);
    this.save();
    this.refreshIgnored();
    return true;
  }

  removeIgnore(name) {
    const key = (name || '').trim().toLowerCase();
    const before = this.settings.ignore.length;
    this.settings.ignore = this.settings.ignore.filter((n) => n !== key);
    if (this.settings.ignore.length === before) return false;
    this.save();
    this.refreshIgnored();
    return true;
  }

  exportLog() {
    const lines = this.entries.map((entry) => {
      const time = new Date(entry.timestamp).toISOString();
      const who = entry.name && entry.name.toLowerCase() !== 'system' ? `${entry.name}: ` : '';
      return `${time} [${entry.kind}] ${who}${entry.text}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `legionuo-journal-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /* ----------------------------- window ----------------------------- */

  isOpen() {
    return !!this.root && !this.root.classList.contains('hidden');
  }

  contains(mx, my) {
    if (!this.isOpen()) return false;
    const rect = this.root.getBoundingClientRect();
    return mx >= rect.left && mx < rect.right && my >= rect.top && my < rect.bottom;
  }

  show(persist = true) {
    if (!this.root) return;
    this.clearOverlay();
    this.root.classList.remove('hidden');
    this.ui?.raiseWindow?.(this);
    if (persist && this.settings.open !== true) {
      this.settings.open = true;
      this.save();
    }
  }

  showSettings() {
    this.show();
    this.options?.classList.remove('hidden');
  }

  hide(persist = true) {
    const active = document.activeElement;
    if (active && this.root?.contains(active)) active.blur();
    this.root?.classList.add('hidden');
    if (persist && this.settings.open !== false) {
      this.settings.open = false;
      this.save();
    }
  }

  toggle() {
    if (!this.root) return;
    if (this.isOpen()) this.hide();
    else this.show();
  }

  applySettings() {
    if (!this.root) return;
    this.root.style.left = `${this.settings.x}px`;
    this.root.style.top = `${this.settings.y}px`;
    this.root.style.width = `${this.settings.width}px`;
    this.root.style.height = `${this.settings.height}px`;
    this.root.style.setProperty('--journal-opacity', String(this.settings.opacity));
    this.root.style.setProperty('--journal-font-size', `${this.settings.fontSize}px`);
    this.root.style.setProperty('--journal-bg', hexToRgb(this.settings.background));
    this.root.classList.toggle('show-times', !!this.settings.timestamps);
    this.setFilter(this.settings.filter);

    const timestamps = $('journalTimestamps');
    if (timestamps) timestamps.checked = !!this.settings.timestamps;
    const fontSize = $('journalFontSize');
    if (fontSize) fontSize.value = String(this.settings.fontSize);
    const opacity = $('journalOpacity');
    if (opacity) opacity.value = String(this.settings.opacity);
    const background = $('journalBackground');
    if (background) background.value = this.settings.background;
    const maxLines = $('journalMaxLines');
    if (maxLines) maxLines.value = String(this.settings.maxLines);
    if (this.modeSelect) this.modeSelect.value = this.settings.mode;
  }

  bind() {
    if (!this.root) return;

    this.root.addEventListener('mousedown', () => this.ui.raiseWindow?.(this), true);

    this.title?.addEventListener('pointerdown', (event) => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('button')) return;
      event.preventDefault();
      this.startDrag(event);
    });

    $('journalResize')?.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.startResize(event);
    });

    $('journalSettingsBtn')?.addEventListener('click', () => {
      this.options?.classList.toggle('hidden');
    });
    $('journalCloseBtn')?.addEventListener('click', () => this.hide());
    $('journalClearBtn')?.addEventListener('click', () => this.clear());

    this.tabs?.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-filter]');
      if (tab) this.setFilter(tab.dataset.filter);
    });

    $('journalTimestamps')?.addEventListener('change', (event) => {
      this.settings.timestamps = event.target.checked;
      this.root.classList.toggle('show-times', !!this.settings.timestamps);
      this.save();
    });
    $('journalFontSize')?.addEventListener('change', (event) => {
      this.settings.fontSize = clamp(parseInt(event.target.value, 10) || DEFAULTS.fontSize, 9, 20);
      this.root.style.setProperty('--journal-font-size', `${this.settings.fontSize}px`);
      this.save();
    });
    $('journalOpacity')?.addEventListener('input', (event) => {
      this.settings.opacity = clamp(parseFloat(event.target.value) || DEFAULTS.opacity, 0.2, 1);
      this.root.style.setProperty('--journal-opacity', String(this.settings.opacity));
      this.save();
    });
    $('journalBackground')?.addEventListener('input', (event) => {
      const value = event.target.value;
      this.settings.background = HEX_COLOR.test(value) ? value : DEFAULTS.background;
      this.root.style.setProperty('--journal-bg', hexToRgb(this.settings.background));
      this.save();
    });
    $('journalMaxLines')?.addEventListener('change', (event) => {
      this.settings.maxLines = clamp(parseInt(event.target.value, 10) || DEFAULTS.maxLines, 50, 5000);
      this.trim();
      this.save();
    });

    this.modeSelect?.addEventListener('change', () => {
      this.settings.mode = this.modeSelect.value;
      this.save();
    });
  }

  startDrag(event) {
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = this.root.offsetLeft;
    const originY = this.root.offsetTop;
    const pointerId = event.pointerId;
    this.drag = { startX, startY, originX, originY };
    this.root.classList.add('dragging');
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      const vp = viewportSize();
      const x = clamp(originX + ev.clientX - startX, 0, Math.max(0, vp.width - 80));
      const y = clamp(originY + ev.clientY - startY, 0, Math.max(0, vp.height - 32));
      this.root.style.left = `${x}px`;
      this.root.style.top = `${y}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.drag = null;
      this.root.classList.remove('dragging');
      this.settings.x = Math.round(this.root.offsetLeft);
      this.settings.y = Math.round(this.root.offsetTop);
      this.save();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  startResize(event) {
    const rect = this.root.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originW = rect.width;
    const originH = rect.height;
    const originX = this.root.offsetLeft;
    const originY = this.root.offsetTop;
    const pointerId = event.pointerId;
    this.resize = { startX, startY, originW, originH };
    this.root.classList.add('resizing');
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      const vp = viewportSize();
      const w = clamp(originW + ev.clientX - startX, 240, Math.max(240, vp.width - originX - 4));
      const h = clamp(originH + ev.clientY - startY, 120, Math.max(120, vp.height - originY - 4));
      this.root.style.width = `${w}px`;
      this.root.style.height = `${h}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.resize = null;
      this.root.classList.remove('resizing');
      const r = this.root.getBoundingClientRect();
      this.settings.width = Math.round(r.width);
      this.settings.height = Math.round(r.height);
      this.save();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  clampToViewport() {
    if (!this.root) return;
    const vp = viewportSize();
    const width = clamp(this.settings.width, 240, Math.max(240, vp.width - 8));
    const height = clamp(this.settings.height, 120, Math.max(120, vp.height - 8));
    this.settings.width = width;
    this.settings.height = height;
    this.settings.x = clamp(this.settings.x, 0, Math.max(0, vp.width - Math.min(width, 80)));
    this.settings.y = clamp(this.settings.y, 0, Math.max(0, vp.height - 40));
    this.applySettings();
  }
}
