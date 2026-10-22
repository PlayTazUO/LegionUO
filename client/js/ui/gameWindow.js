import { clamp, isMobileLayout, viewportSize } from '../util/ui.js';

const STORAGE_KEY = 'legionuo.gameWindow.v1';
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 700;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const MOBILE_MIN_WIDTH = 240;
const MOBILE_MIN_HEIGHT = 180;

export class GameWindow {
  constructor(game, onChange) {
    this.game = game;
    this.onChange = onChange;
    this.root = document.getElementById('gameWindow');
    this.titleBar = document.getElementById('gameTitleBar');
    this.titleName = document.getElementById('gameTitle');
    this.resizeHandle = document.getElementById('gameResize');
    this.titleStats = {};
    this.titleStatKey = '';
    for (const el of this.titleBar?.querySelectorAll('.titleStat') || []) {
      this.titleStats[el.dataset.stat] = {
        fill: el.querySelector('.titleStatFill'),
        text: el.querySelector('.titleStatText'),
      };
    }
    if (!this.root || !this.titleBar || !this.resizeHandle) return;

    const saved = this.load();
    const mobile = isMobileLayout();
    const vp = viewportSize();
    const minWidth = mobile ? MOBILE_MIN_WIDTH : MIN_WIDTH;
    const minHeight = mobile ? MOBILE_MIN_HEIGHT : MIN_HEIGHT;
    const titleHeight = this.titleHeight();
    const maxWidth = Math.max(minWidth, vp.width);
    const maxHeight = Math.max(minHeight, vp.height - titleHeight);
    this.fillViewport = mobile && !saved.width && !saved.height;

    if (!saved.width && !saved.height) {
      this.width = mobile ? maxWidth : Math.min(DEFAULT_WIDTH, maxWidth);
      this.height = mobile ? maxHeight : Math.min(DEFAULT_HEIGHT, maxHeight);
    } else {
      this.width = clamp(saved.width ?? DEFAULT_WIDTH, Math.min(minWidth, maxWidth), maxWidth);
      this.height = clamp(saved.height ?? DEFAULT_HEIGHT, Math.min(minHeight, maxHeight), maxHeight);
    }

    this.x = clamp(
      saved.x ?? Math.round((vp.width - this.width) / 2),
      0,
      Math.max(0, vp.width - this.width)
    );
    this.y = clamp(
      saved.y ?? Math.round((vp.height - this.height - titleHeight) / 2),
      0,
      Math.max(0, vp.height - this.height - titleHeight)
    );
    this.apply();
    this.bind();
  }

  titleHeight() {
    return this.titleBar?.offsetHeight || 26;
  }

  updateTitleBar(player = this.game.world?.player) {
    const name = player?.name || '';
    const stats = [
      ['hits', 'HP', player?.hits, player?.hitsMax],
      ['stamina', 'STAM', player?.stamina, player?.staminaMax],
      ['mana', 'MANA', player?.mana, player?.manaMax],
    ];
    const key = [name, ...stats.map(([, , value, max]) => `${value ?? ''}/${max ?? ''}`)].join('|');
    if (key === this.titleStatKey) return;
    this.titleStatKey = key;
    if (this.titleName) this.titleName.textContent = name;
    for (const [stat, label, value, max] of stats) {
      const entry = this.titleStats[stat];
      if (!entry) continue;
      const maxValue = Number(max);
      const hasMax = maxValue > 0;
      const current = hasMax ? clamp(Number(value) || 0, 0, maxValue) : 0;
      if (entry.fill) entry.fill.style.width = `${hasMax ? (current / maxValue) * 100 : 0}%`;
      if (entry.text) {
        entry.text.textContent = hasMax ? `${label} ${current}/${maxValue}` : `${label} --`;
      }
    }
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: this.x, y: this.y, width: this.width, height: this.height })
      );
    } catch {
      /* ignore quota errors */
    }
  }

  apply() {
    this.root.style.left = `${this.x}px`;
    this.root.style.top = `${this.y}px`;
    this.root.style.width = `${this.width}px`;
    this.root.style.height = `${this.height + this.titleHeight()}px`;
  }

  notify() {
    this.onChange?.();
  }

  bind() {
    this.titleBar.addEventListener('pointerdown', (event) => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('button')) return;
      event.preventDefault();
      this.startDrag(event);
    });

    this.resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.startResize(event);
    });

    window.addEventListener('resize', () => this.onWindowResize());
    window.visualViewport?.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onWindowResize(), 120));
  }

  startDrag(event) {
    this.fillViewport = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = this.x;
    const originY = this.y;
    const pointerId = event.pointerId;
    this.root.classList.add('dragging');
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      const vp = viewportSize();
      this.x = clamp(originX + ev.clientX - startX, 0, Math.max(0, vp.width - this.width));
      this.y = clamp(
        originY + ev.clientY - startY,
        0,
        Math.max(0, vp.height - this.height - this.titleHeight())
      );
      this.root.style.left = `${this.x}px`;
      this.root.style.top = `${this.y}px`;
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.root.classList.remove('dragging');
      this.save();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  startResize(event) {
    this.fillViewport = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const originW = this.width;
    const originH = this.height;
    const pointerId = event.pointerId;
    this.root.classList.add('resizing');
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      const vp = viewportSize();
      const maxW = Math.max(MIN_WIDTH, vp.width - this.x);
      const maxH = Math.max(MIN_HEIGHT, vp.height - this.y - this.titleHeight());
      this.width = clamp(originW + ev.clientX - startX, Math.min(MIN_WIDTH, maxW), maxW);
      this.height = clamp(originH + ev.clientY - startY, Math.min(MIN_HEIGHT, maxH), maxH);
      this.apply();
      this.notify();
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.root.classList.remove('resizing');
      this.save();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  onWindowResize() {
    const mobile = isMobileLayout();
    const vp = viewportSize();
    const minWidth = mobile ? MOBILE_MIN_WIDTH : MIN_WIDTH;
    const minHeight = mobile ? MOBILE_MIN_HEIGHT : MIN_HEIGHT;
    const maxW = Math.max(minWidth, vp.width);
    const maxH = Math.max(minHeight, vp.height - this.titleHeight());
    if (this.fillViewport) {
      this.width = maxW;
      this.height = maxH;
      this.x = 0;
      this.y = 0;
      this.apply();
      this.notify();
      return;
    }
    this.width = clamp(this.width, Math.min(minWidth, maxW), maxW);
    this.height = clamp(this.height, Math.min(minHeight, maxH), maxH);
    this.x = clamp(this.x, 0, Math.max(0, vp.width - this.width));
    this.y = clamp(this.y, 0, Math.max(0, vp.height - this.height - this.titleHeight()));
    this.apply();
    this.notify();
    this.save();
  }
}
