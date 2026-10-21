import { accountStorageKey, clampPosition } from '../util/ui.js';

const BUFF_STORAGE_BASE = 'legionuo.buffs.v1';
const ICON_SIZE = 40;
const GAP = 4;
const PAD = 6;
const HEADER = 18;
const MAX_COLS = 8;
const MIN_WIDTH = 140;

const BUFF_GRAPHICS = [
  0x754c, 0x754a, 0x0000, 0x0000, 0x755e, 0x7549, 0x7551, 0x7556, 0x753a, 0x754d,
  0x754e, 0x7565, 0x753b, 0x7543, 0x7544, 0x7546, 0x755c, 0x755f, 0x7566, 0x7554,
  0x7540, 0x7568, 0x754f, 0x7550, 0x7553, 0x753e, 0x755d, 0x7563, 0x7562, 0x753f,
  0x7559, 0x7557, 0x754b, 0x753d, 0x7561, 0x7558, 0x755b, 0x7560, 0x7541, 0x7545,
  0x7552, 0x7569, 0x7548, 0x755a, 0x753c, 0x7547, 0x7567, 0x7542, 0x758a, 0x758b,
  0x758c, 0x758d, 0x0000, 0x758e, 0x094b, 0x094c, 0x094d, 0x094e, 0x094f, 0x0950,
  0x753e, 0x5011, 0x7590, 0x7591, 0x7592, 0x7593, 0x7594, 0x7595, 0x7596, 0x7598,
  0x7599, 0x759b, 0x759c, 0x759e, 0x759f, 0x75a0, 0x75a1, 0x75a3, 0x75a4, 0x75a5,
  0x75a6, 0x75a7, 0x75c0, 0x75c1, 0x75c2, 0x75c3, 0x75c4, 0x75f2, 0x75f3, 0x75f4,
  0x75f5, 0x75f6, 0x75f7, 0x75f8, 0x75f9, 0x75fa, 0x75fb, 0x75fc, 0x75fd, 0x75fe,
  0x75ff, 0x7600, 0x7601, 0x7602, 0x7603, 0x7604, 0x7605, 0x7606, 0x7607, 0x7608,
  0x7609, 0x760a, 0x760b, 0x760c, 0x760d, 0x760e, 0x760f, 0x7610, 0x7611, 0x7612,
  0x7613, 0x7614, 0x7615, 0x75c5, 0x75f6, 0x761b, 0x9bc9, 0x9bb5, 0x9bdd, 0x9bc6,
  0x9bcc, 0x9bbe, 0x9bbd, 0x9bcb, 0x9bc8, 0x9bbf, 0x9bcd, 0x9bc0, 0x9bce, 0x9bc1,
  0x9bc7, 0x9bc2, 0x9bb7, 0x9bca, 0x9bb6, 0x9bb8, 0x9bb9, 0x9bba, 0x9bbb, 0x9bbc,
  0x9bc3, 0x9bc4, 0x9bc5, 0x9bd2, 0x9bd3, 0x9bd4, 0x9bd5, 0x9bd1, 0x9bd6, 0x9bd7,
  0x9bcf, 0x9bd8, 0x9bd9, 0x9bdb, 0x9bdc, 0x9bda, 0x9bd0, 0x9bde, 0x9bdf, 0xc349,
  0xc34d, 0xc34e, 0xc34c, 0xc34b, 0xc34a, 0xc343, 0xc345, 0xc346, 0xc347, 0xc348,
  0x9cde, 0x5de1, 0x5ddf, 0x5de3, 0x5de5, 0x5de4, 0x5de6, 0x5d51, 0x0951,
];

export function buffGraphic(type) {
  const icon = type >= 0x3e9 ? type - 0x3e9 : -1;
  if (icon < 0 || icon >= BUFF_GRAPHICS.length) return 0;
  return BUFF_GRAPHICS[icon];
}

export function buffTimeLeft(buff, now = Date.now()) {
  if (!buff.endsAt) return 0;
  return Math.max(0, buff.endsAt - now);
}

export function formatBuffTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function splitLines(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buffText(buff, game) {
  const title = buff.titleId > 0 ? game.cliloc(buff.titleId, buff.titleArgs) || '' : '';
  const description = buff.descId > 0 ? game.cliloc(buff.descId, buff.descArgs || buff.titleArgs) || '' : '';
  const extra = buff.altId > 0 ? game.cliloc(buff.altId, buff.altArgs || buff.titleArgs) || '' : '';
  const titleLines = splitLines(title);
  const descriptionLines = splitLines(description);
  const extraLines = splitLines(extra);
  return {
    title: titleLines[0] || '',
    lines: [...titleLines.slice(1), ...descriptionLines, ...extraLines],
  };
}

function buffStorageKey(world) {
  return accountStorageKey(world, BUFF_STORAGE_BASE);
}

export class BuffBarWindow {
  constructor(world) {
    this.world = world;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.hoverIndex = -1;
    this.orientation = 'row';
    this.iconScale = 1;
    this.warned = new Set();
    this.x = Math.max(20, window.innerWidth - 300);
    this.y = 60;
    try {
      const saved = JSON.parse(localStorage.getItem(buffStorageKey(world)) || 'null');
      if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
        this.x = Number(saved.x);
        this.y = Number(saved.y);
      }
      if (saved?.orientation === 'column') this.orientation = 'column';
      if (Number.isFinite(Number(saved?.iconScale))) this.iconScale = Math.max(0.7, Math.min(1.5, Number(saved.iconScale)));
    } catch {
      /* ignore */
    }
  }

  get iconSize() {
    return Math.max(24, Math.round(ICON_SIZE * this.iconScale));
  }

  get perRow() {
    return this.orientation === 'column' ? 1 : MAX_COLS;
  }

  configure(option) {
    if (option === 'row' || option === 'column') this.orientation = option;
    else if (option === 'small') this.iconScale = 0.75;
    else if (option === 'large') this.iconScale = 1.25;
    else if (option === 'normal') this.iconScale = 1;
    this.savePosition();
  }

  get buffs() {
    const now = Date.now();
    return (this.world.buffs || []).filter((buff) => !buff.endsAt || buff.endsAt > now);
  }

  get cols() {
    return Math.min(this.perRow, Math.max(1, this.buffs.length));
  }

  get rows() {
    return Math.max(1, Math.ceil(this.buffs.length / this.perRow));
  }

  get iconsWidth() {
    return this.cols * this.iconSize + (this.cols - 1) * GAP;
  }

  get width() {
    return Math.max(MIN_WIDTH, PAD * 2 + this.iconsWidth);
  }

  get height() {
    return HEADER + PAD * 2 + this.rows * this.iconSize + (this.rows - 1) * GAP;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 17, y: this.y + 4, w: 12, h: 12 };
  }

  iconRect(index) {
    const col = index % this.perRow;
    const row = Math.floor(index / this.perRow);
    return {
      x: this.x + (this.width - this.iconsWidth) / 2 + col * (this.iconSize + GAP),
      y: this.y + HEADER + PAD + row * (this.iconSize + GAP),
      w: this.iconSize,
      h: this.iconSize,
    };
  }

  iconAt(mx, my) {
    const buffs = this.buffs;
    for (let i = 0; i < buffs.length; i++) {
      const rect = this.iconRect(i);
      if (mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h) return { buff: buffs[i], index: i };
    }
    return null;
  }

  tooltipAt(mx, my) {
    const hit = this.iconAt(mx, my);
    if (!hit) return null;
    const data = buffText(hit.buff, this.world.game);
    const lines = [...data.lines];
    const left = buffTimeLeft(hit.buff);
    if (hit.buff.endsAt) lines.push(`Time left: ${formatBuffTime(left)}`);
    return {
      id: `buff:${hit.buff.icon}`,
      title: data.title || 'Effect',
      lines,
    };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    const close = this.closeRect();
    if (mx >= close.x && my >= close.y && mx < close.x + close.w && my < close.y + close.h) {
      this.close();
      return true;
    }
    if (this.iconAt(mx, my)) return true;
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    this.hoverIndex = this.iconAt(mx, my)?.index ?? -1;
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  close() {
    this.savePosition();
    this.world.game.ui.closeBuffs();
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    try {
      localStorage.setItem(
        buffStorageKey(this.world),
        JSON.stringify({ x: this.x, y: this.y, orientation: this.orientation, iconScale: this.iconScale })
      );
    } catch {
      /* ignore quota errors */
    }
  }

  drawFallback(ctx, rect, buff) {
    const hue = ((buff.icon || 0) * 47) % 360;
    ctx.fillStyle = `hsl(${hue} 40% 26%)`;
    ctx.fillRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.strokeStyle = `hsl(${hue} 55% 55%)`;
    ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3);
    const data = buffText(buff, this.world.game);
    const letter = (data.title || '?').trim().charAt(0).toUpperCase() || '?';
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  draw(ctx) {
    const buffs = this.buffs;
    const width = this.width;
    const height = this.height;
    ctx.fillStyle = 'rgba(18,15,10,0.9)';
    ctx.fillRect(this.x, this.y, width, height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, width - 1, height - 1);
    ctx.fillStyle = '#c9b06c';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(buffs.length ? `Effects (${buffs.length})` : 'Effects', this.x + PAD, this.y + 5);
    const close = this.closeRect();
    ctx.fillStyle = '#8d7a52';
    ctx.fillRect(close.x, close.y, close.w, close.h);
    ctx.fillStyle = '#1a150d';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('x', close.x + close.w / 2, close.y + close.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (!buffs.length) {
      ctx.fillStyle = '#8d8060';
      ctx.font = '11px monospace';
      ctx.fillText('No active effects', this.x + PAD, this.y + HEADER + PAD + 12);
      return;
    }

    const now = Date.now();
    for (let i = 0; i < buffs.length; i++) {
      const buff = buffs[i];
      const rect = this.iconRect(i);
      const img = buff.graphic ? this.world.assets.getGump(buff.graphic) : null;
      if (img && img.width > 0 && img.height > 0) {
        const scale = Math.min(rect.w / img.width, rect.h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
      } else {
        this.drawFallback(ctx, rect, buff);
      }
      if (this.hoverIndex === i) {
        ctx.strokeStyle = '#e8d7a8';
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      }
      if (buff.endsAt) {
        const left = Math.max(0, buff.endsAt - now);
        const warnKey = `${buff.icon}:${buff.endsAt}`;
        if (left > 0 && left < 10000 && !this.warned.has(warnKey)) {
          this.warned.add(warnKey);
          this.world.game?.audio?.warning?.();
        }
        const total = Math.max(1, buff.time ? buff.endsAt - buff.time : buff.timer * 1000);
        const pct = Math.max(0, Math.min(1, left / total));
        const stripY = rect.y + rect.h - 14;
        const low = left < 10000;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(rect.x, stripY, rect.w, 14);
        ctx.fillStyle = low ? 'rgba(224,139,106,0.55)' : 'rgba(201,176,108,0.4)';
        ctx.fillRect(rect.x, stripY, rect.w * pct, 14);
        ctx.fillStyle = low ? '#ffb08a' : '#e8d7a8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatBuffTime(left), rect.x + rect.w / 2, rect.y + rect.h - 7);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
      if (buff.count > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(rect.x + rect.w - 17, rect.y + 1, 16, 13);
        ctx.fillStyle = '#ffe08a';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(buff.count), rect.x + rect.w - 9, rect.y + 8);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
    }
    for (const key of [...this.warned]) {
      const [icon, endsAt] = key.split(':');
      if (Number(endsAt) < now - 1000 || !buffs.some((buff) => String(buff.icon) === icon && String(buff.endsAt) === endsAt)) this.warned.delete(key);
    }
  }
}
