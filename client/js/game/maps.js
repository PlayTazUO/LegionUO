import { withServerParam } from './serverCache.js';

const RADAR_STORAGE_BASE = 'legionuo.radar.v1';
const MAP_STORAGE_BASE = 'legionuo.mapgump.v1';
const BASE_MAP_SIZE = 200;
const LARGE_MAP_SIZE = 288;
const TITLE_HEIGHT = 22;
const MAP_MARGIN = 10;
const BUTTON_HEIGHT = 22;
const RADAR_REFRESH_MS = 500;

const FIVE_BIT = [
  0x00, 0x08, 0x10, 0x18, 0x20, 0x29, 0x31, 0x39, 0x41, 0x4a, 0x52, 0x5a, 0x62, 0x6a, 0x73, 0x7b,
  0x83, 0x8b, 0x94, 0x9c, 0xa4, 0xac, 0xb4, 0xbd, 0xc5, 0xcd, 0xd5, 0xde, 0xe6, 0xee, 0xf6, 0xff,
];

const radarCache = new Map();
const staticCache = new WeakMap();

function radarEntry(world) {
  const key = world?.assets?.serverId || '';
  let entry = radarCache.get(key);
  if (!entry) {
    entry = { colors: null, bytes: null, promise: null, waiters: new Set() };
    radarCache.set(key, entry);
  }
  return entry;
}

function storageKey(world, base) {
  const account = (world.game?.loginCredentials?.account || '').trim().toLowerCase();
  return account ? `${base}.${account}` : base;
}

function loadSaved(world, base) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(world, base)) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveSaved(world, base, value) {
  try {
    localStorage.setItem(storageKey(world, base), JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

function clampPosition(x, y, width, height) {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - height))),
  };
}

function notorietyColor(noto) {
  switch (noto) {
    case 1:
      return '#6fb7ff';
    case 2:
      return '#7ee08a';
    case 3:
      return '#c8c8c8';
    case 4:
      return '#ffd34a';
    case 5:
      return '#ff8a3a';
    case 6:
      return '#ff4a4a';
    case 7:
      return '#ff5cd6';
    default:
      return '#e8e8e8';
  }
}

function buildRadarBytes(data) {
  const count = 0x14000;
  const bytes = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const value = data && i < data.length ? data[i] : 0;
    const p = i * 3;
    bytes[p] = FIVE_BIT[(value >> 10) & 0x1f];
    bytes[p + 1] = FIVE_BIT[(value >> 5) & 0x1f];
    bytes[p + 2] = FIVE_BIT[value & 0x1f];
  }
  return bytes;
}

function radarColorData(world, onReady) {
  const entry = radarEntry(world);
  if (entry.colors !== null) {
    if (entry.colors.length) onReady?.();
    return entry.colors;
  }
  if (onReady) entry.waiters.add(onReady);
  if (!entry.promise) {
    entry.promise = fetch(withServerParam('/api/radarcol', world?.config))
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => {
        let colors;
        if (!buffer) {
          colors = new Uint16Array(0);
        } else {
          const view = new DataView(buffer);
          colors = new Uint16Array(Math.floor(buffer.byteLength / 2));
          for (let i = 0; i < colors.length; i++) colors[i] = view.getUint16(i * 2, true);
        }
        entry.colors = colors;
        entry.bytes = buildRadarBytes(colors);
      })
      .catch(() => {
        entry.colors = new Uint16Array(0);
        entry.bytes = buildRadarBytes(entry.colors);
      })
      .finally(() => {
        for (const callback of entry.waiters) callback();
        entry.waiters.clear();
      });
  }
  return entry.colors || new Uint16Array(0);
}

function hasRadarColor(world, index) {
  const entry = radarEntry(world);
  return !!entry.colors && index < entry.colors.length && entry.colors[index] !== 0;
}

function fallbackColor(index, isStatic) {
  const hash = Math.imul(index + 1, 2654435761) >>> 0;
  if (isStatic) {
    return [140 + (hash & 0x1f), 130 + ((hash >> 8) & 0x1f), 110 + ((hash >> 16) & 0x1f)];
  }
  return [45 + (hash & 0x1f), 80 + ((hash >> 8) & 0x3f), 45 + ((hash >> 16) & 0x1f)];
}

function colorFor(world, index, isStatic) {
  if (hasRadarColor(world, index)) {
    const p = index * 3;
    const bytes = radarEntry(world).bytes;
    return [bytes[p], bytes[p + 1], bytes[p + 2]];
  }
  return fallbackColor(index, isStatic);
}

function blockStaticColors(block) {
  if (!block) return null;
  const cached = staticCache.get(block);
  if (cached) return cached;
  const colors = new Uint16Array(64);
  const zs = new Int8Array(64);
  zs.fill(-128);
  for (const s of block.statics || []) {
    const index = ((s.y & 7) << 3) | (s.x & 7);
    if (s.z > zs[index]) {
      zs[index] = s.z;
      colors[index] = 0x4000 + s.graphic;
    }
  }
  const result = { colors, zs };
  staticCache.set(block, result);
  return result;
}

function drawWindowFrame(ctx, x, y, width, height, title, closeRect) {
  ctx.fillStyle = 'rgba(18,15,10,0.96)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#8d7a52';
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = 'rgba(201,176,108,0.12)';
  ctx.fillRect(x + 1, y + 1, width - 2, TITLE_HEIGHT);
  ctx.fillStyle = '#e8d7a8';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + 8, y + TITLE_HEIGHT / 2 + 1);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(closeRect.x, closeRect.y, closeRect.w, closeRect.h);
  ctx.strokeStyle = '#5f5133';
  ctx.strokeRect(closeRect.x + 0.5, closeRect.y + 0.5, closeRect.w - 1, closeRect.h - 1);
  ctx.fillStyle = '#d9c58d';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('X', closeRect.x + closeRect.w / 2, closeRect.y + closeRect.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

function drawButton(ctx, rect, label, active = false) {
  ctx.fillStyle = active ? 'rgba(201,176,108,0.3)' : 'rgba(0,0,0,0.28)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = active ? '#c9b06c' : '#5f5133';
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx.fillStyle = active ? '#f0dfa8' : '#d9c58d';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

function inside(rect, x, y) {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

export class MinimapWindow {
  constructor(world) {
    this.world = world;
    this.saved = loadSaved(world, RADAR_STORAGE_BASE);
    this.large = !!this.saved.large;
    this.x = Number(this.saved.x) || 20;
    this.y = Number(this.saved.y) || 80;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.dirty = true;
    this.cacheKey = '';
    this.lastRender = 0;
    this.buffer = document.createElement('canvas');
    this.buffer.width = BASE_MAP_SIZE;
    this.buffer.height = BASE_MAP_SIZE;
    this.bufferCtx = this.buffer.getContext('2d');
    this.clampPosition();
    radarColorData(this.world, () => {
      this.dirty = true;
    });
  }

  get size() {
    return this.large ? LARGE_MAP_SIZE : BASE_MAP_SIZE;
  }

  get width() {
    return this.size + MAP_MARGIN * 2;
  }

  get height() {
    return this.size + TITLE_HEIGHT + MAP_MARGIN;
  }

  get mapRect() {
    return { x: this.x + MAP_MARGIN, y: this.y + TITLE_HEIGHT, w: this.size, h: this.size };
  }

  get closeRect() {
    return { x: this.x + this.width - 22, y: this.y + 3, w: 18, h: 16 };
  }

  get canCloseWithEsc() {
    return true;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  clampPosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  savePosition() {
    this.saved = { x: Math.round(this.x), y: Math.round(this.y), large: this.large };
    saveSaved(this.world, RADAR_STORAGE_BASE, this.saved);
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || inside(this.closeRect, mx, my)) {
      this.close();
      return true;
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (!this.dragging) return;
    this.x = mx - this.dragOffset.x;
    this.y = my - this.dragOffset.y;
    this.clampPosition();
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  tileAt(mx, my) {
    const area = this.mapRect;
    const player = this.world.player;
    if (!player) return null;
    const scale = area.w / BASE_MAP_SIZE;
    if (!scale) return null;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const a = mx - cx;
    const b = my - cy;
    return {
      x: player.x + (a + b) / (2 * scale),
      y: player.y + (b - a) / (2 * scale),
    };
  }

  onDoubleClick(mx, my) {
    if (inside(this.mapRect, mx, my)) {
      const tile = this.tileAt(mx, my);
      const player = this.world.player;
      if (!tile || !player) return;
      const [mapW, mapH] = this.world.uolive?.mapSize?.(this.world.mapIndex) || [7168, 4096];
      const x = Math.round(Math.max(0, Math.min(mapW - 1, tile.x)));
      const y = Math.round(Math.max(0, Math.min(mapH - 1, tile.y)));
      this.world.game.walkTo(x, y);
      this.world.game.ui?.addJournal?.(`Walking to ${x}, ${y}.`, '#b8a06a', true);
      return;
    }
    this.large = !this.large;
    this.clampPosition();
    this.savePosition();
  }

  close() {
    this.savePosition();
    this.world.game.ui?.closeRadar?.();
  }

  rebuild(now) {
    const player = this.world.player;
    if (!player) return;
    const key = `${player.x},${player.y}`;
    if (key === this.cacheKey && !this.dirty && now - this.lastRender < RADAR_REFRESH_MS) return;
    this.cacheKey = key;
    this.dirty = false;
    this.lastRender = now;

    const size = BASE_MAP_SIZE;
    const ctx = this.bufferCtx;
    const image = ctx.createImageData(size, size);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 20;
      pixels[i + 1] = 18;
      pixels[i + 2] = 14;
      pixels[i + 3] = 255;
    }

    const center = size >> 1;
    const radius = center + 4;
    const px = player.x;
    const py = player.y;
    const minBx = (px - radius) >> 3;
    const maxBx = (px + radius) >> 3;
    const minBy = (py - radius) >> 3;
    const maxBy = (py + radius) >> 3;

    for (let bx = minBx; bx <= maxBx; bx++) {
      for (let by = minBy; by <= maxBy; by++) {
        const block = this.world.getBlock(bx, by);
        if (!block) continue;
        const statics = blockStaticColors(block);
        for (let i = 0; i < 64; i++) {
          const tx = (bx << 3) + (i & 7);
          const ty = (by << 3) + (i >> 3);
          const dx = tx - px;
          const dy = ty - py;
          const gx = center + dx - dy;
          const gy = center + dx + dy;
          if (gx < 0 || gy < 0 || gx >= size || gy >= size) continue;

          const cell = block.cells[i];
          let index = cell.tile;
          let isStatic = false;
          if (statics) {
            const staticIndex = statics.colors[i];
            if (staticIndex && statics.zs[i] >= cell.z && hasRadarColor(this.world, staticIndex)) {
              index = staticIndex;
              isStatic = true;
            }
          }
          const [r, g, b] = colorFor(this.world, index, isStatic);
          const p = (gy * size + gx) * 4;
          pixels[p] = r;
          pixels[p + 1] = g;
          pixels[p + 2] = b;
          pixels[p + 3] = 255;
        }
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  drawOverlay(ctx, now) {
    const area = this.mapRect;
    const scale = area.w / BASE_MAP_SIZE;
    const player = this.world.player;
    if (!player) return;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;

    for (const entity of this.world.entities.values()) {
      if (!entity.isItem || !entity.isMulti || !entity.hasPosition) continue;
      const parts = this.world.assets.getMulti(entity.graphic);
      if (!parts || !parts.length) continue;
      for (const part of parts) {
        const tx = entity.x + (part.x || 0);
        const ty = entity.y + (part.y || 0);
        const dx = tx - player.x;
        const dy = ty - player.y;
        const gx = cx + (dx - dy) * scale;
        const gy = cy + (dx + dy) * scale;
        if (gx < area.x || gy < area.y || gx >= area.x + area.w || gy >= area.y + area.h) continue;
        const [r, g, b] = colorFor(this.world, 0x4000 + (part.graphic || 0), true);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(Math.round(gx), Math.round(gy), 2, 2);
      }
    }

    for (const entity of this.world.entities.values()) {
      if (!entity.isMobile || entity === player || !entity.hasPosition) continue;
      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      const gx = cx + (dx - dy) * scale;
      const gy = cy + (dx + dy) * scale;
      if (gx < area.x || gy < area.y || gx >= area.x + area.w || gy >= area.y + area.h) continue;
      ctx.fillStyle = notorietyColor(entity.notoriety);
      ctx.fillRect(Math.round(gx), Math.round(gy), 2, 2);
    }

    for (const waypoint of [...(this.world.waypoints || []), ...(this.world.localWaypoints || [])]) {
      if (waypoint.map !== this.world.mapIndex) continue;
      const dx = waypoint.x - player.x;
      const dy = waypoint.y - player.y;
      const gx = cx + (dx - dy) * scale;
      const gy = cy + (dx + dy) * scale;
      if (gx < area.x || gy < area.y || gx >= area.x + area.w || gy >= area.y + area.h) continue;
      ctx.fillStyle = '#ffd34a';
      ctx.fillRect(Math.round(gx) - 1, Math.round(gy) - 1, 3, 3);
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 3);
  }

  draw(ctx, now) {
    this.rebuild(now);
    drawWindowFrame(ctx, this.x, this.y, this.width, this.height, 'Radar', this.closeRect);

    const area = this.mapRect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, area.x, area.y, area.w, area.h);
    ctx.restore();
    ctx.strokeStyle = '#4d4228';
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1);
    this.drawOverlay(ctx, now);

    ctx.fillStyle = '#9e8e65';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${this.world.player?.x ?? 0}, ${this.world.player?.y ?? 0}`, area.x + area.w - 2, area.y + area.h - 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

export class MapGumpWindow {
  constructor(world, serial, width, height, startX, startY, endX, endY, facet) {
    this.world = world;
    this.serial = serial >>> 0;
    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
    this.facet = facet || 0;
    this.pins = [];
    this.plotState = 0;
    this.loading = true;
    this.failed = false;
    this.image = null;

    const regionW = Math.max(1, endX - startX);
    const regionH = Math.max(1, endY - startY);
    this.mapW = Math.max(120, Math.min(560, Math.round(width || regionW)));
    this.mapH = Math.max(120, Math.min(560, Math.round(height || regionH)));
    this.pinSpaceW = Math.max(1, width || regionW);
    this.pinSpaceH = Math.max(1, height || regionH);

    const saved = loadSaved(world, MAP_STORAGE_BASE)[String(this.serial)] || {};
    this.width = this.mapW + MAP_MARGIN * 2;
    this.height = TITLE_HEIGHT + this.mapH + MAP_MARGIN + BUTTON_HEIGHT + 8;
    this.x = Number.isFinite(saved.x) ? saved.x : Math.max(20, (window.innerWidth - this.width) / 2);
    this.y = Number.isFinite(saved.y) ? saved.y : Math.max(20, (window.innerHeight - this.height) / 2);
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.clampPosition();
    this.loadImage();
  }

  get canCloseWithEsc() {
    return true;
  }

  get mapRect() {
    return { x: this.x + MAP_MARGIN, y: this.y + TITLE_HEIGHT, w: this.mapW, h: this.mapH };
  }

  get closeRect() {
    return { x: this.x + this.width - 22, y: this.y + 3, w: 18, h: 16 };
  }

  get buttonY() {
    return this.y + TITLE_HEIGHT + this.mapH + 6;
  }

  get buttons() {
    return [
      { id: 'plot', label: this.plotState ? 'Stop' : 'Plot', x: this.x + MAP_MARGIN, w: 70 },
      { id: 'clear', label: 'Clear', x: this.x + this.width - MAP_MARGIN - 70, w: 70 },
    ].map((button) => ({ ...button, y: this.buttonY, h: BUTTON_HEIGHT }));
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  clampPosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  savePosition() {
    const all = loadSaved(this.world, MAP_STORAGE_BASE);
    all[String(this.serial)] = { x: Math.round(this.x), y: Math.round(this.y) };
    saveSaved(this.world, MAP_STORAGE_BASE, all);
  }

  loadImage() {
    const width = Math.min(this.mapW, 560);
    const height = Math.min(this.mapH, 560);
    const params = new URLSearchParams({
      facet: String(this.facet),
      x0: String(this.startX),
      y0: String(this.startY),
      x1: String(this.endX),
      y1: String(this.endY),
      w: String(width),
      h: String(height),
    });
    const image = new Image();
    image.onload = () => {
      this.image = image;
      this.loading = false;
    };
    image.onerror = () => {
      this.loading = false;
      this.failed = true;
    };
    image.src = this.world.assets.url(`/api/mapimage?${params}`);
  }

  addPin(x, y) {
    this.pins.push({ x: Math.max(0, Math.min(this.pinSpaceW, x)), y: Math.max(0, Math.min(this.pinSpaceH, y)) });
  }

  clearPins() {
    this.pins = [];
  }

  setPlotState(state) {
    this.plotState = state ? 1 : 0;
  }

  pinPosition(pin) {
    const area = this.mapRect;
    return {
      x: area.x + (pin.x / this.pinSpaceW) * area.w,
      y: area.y + (pin.y / this.pinSpaceH) * area.h,
    };
  }

  pinAt(mx, my) {
    for (let i = this.pins.length - 1; i >= 0; i--) {
      const p = this.pinPosition(this.pins[i]);
      if (mx >= p.x - 5 && my >= p.y - 5 && mx < p.x + 5 && my < p.y + 5) return i + 1;
    }
    return 0;
  }

  tooltipAt(mx, my) {
    const index = this.pinAt(mx, my);
    if (!index) return null;
    return { id: `mappin:${this.serial}:${index}`, title: `Pin ${index}` };
  }

  togglePlot() {
    this.world.socket.out.mapMessage(this.serial, 6, this.plotState, 0xffe8, 0xffe1);
    this.plotState = this.plotState ? 0 : 1;
  }

  clearCourse() {
    this.world.socket.out.mapMessage(this.serial, 5, 0, 0xffe8, 0xffe1);
    this.clearPins();
  }

  addLocalPin(mx, my) {
    const area = this.mapRect;
    const x = ((mx - area.x) / area.w) * this.pinSpaceW;
    const y = ((my - area.y) / area.h) * this.pinSpaceH;
    this.world.socket.out.mapMessage(this.serial, 1, 0, Math.round(x), Math.round(y));
    this.addPin(x, y);
    const worldX = Math.round(this.startX + (x / this.pinSpaceW) * (this.endX - this.startX));
    const worldY = Math.round(this.startY + (y / this.pinSpaceH) * (this.endY - this.startY));
    this.world.game.ui?.addJournal?.(`Map location: approximately ${worldX}, ${worldY}.`, '#b8a06a', true);
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || inside(this.closeRect, mx, my)) {
      this.close();
      return true;
    }
    if (button === 0) {
      for (const buttonRect of this.buttons) {
        if (inside(buttonRect, mx, my)) {
          if (buttonRect.id === 'plot') this.togglePlot();
          else this.clearCourse();
          return true;
        }
      }
      if (this.plotState && !this.loading && !this.failed && inside(this.mapRect, mx, my)) {
        this.addLocalPin(mx, my);
        return true;
      }
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (!this.dragging) return;
    this.x = mx - this.dragOffset.x;
    this.y = my - this.dragOffset.y;
    this.clampPosition();
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  close() {
    this.savePosition();
    this.world.game.ui?.closeMapGump?.(this.serial);
  }

  draw(ctx) {
    drawWindowFrame(ctx, this.x, this.y, this.width, this.height, 'Map', this.closeRect);
    const area = this.mapRect;

    ctx.fillStyle = '#080705';
    ctx.fillRect(area.x, area.y, area.w, area.h);
    if (this.image) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.image, area.x, area.y, area.w, area.h);
    } else {
      ctx.fillStyle = '#8d7a52';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.failed ? 'No map art available.' : 'Loading map...', area.x + area.w / 2, area.y + area.h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    if (this.pins.length) {
      ctx.strokeStyle = 'rgba(255, 211, 74, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < this.pins.length; i++) {
        const p = this.pinPosition(this.pins[i]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      for (let i = 0; i < this.pins.length; i++) {
        const p = this.pinPosition(this.pins[i]);
        ctx.fillStyle = '#ffd34a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2b1f08';
        ctx.stroke();
        ctx.fillStyle = '#ffeaa0';
        ctx.font = '9px monospace';
        ctx.fillText(String(i + 1), p.x + 4, p.y - 3);
      }
    }

    ctx.strokeStyle = '#4d4228';
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1);

    for (const button of this.buttons) {
      const active = button.id === 'plot' && this.plotState;
      drawButton(ctx, button, button.label, active);
    }
  }
}

const WORLD_MAP_STORAGE_BASE = 'legionuo.worldmap.v1';
const WORLD_MAP_FACETS = ['Felucca', 'Trammel', 'Ilshenar', 'Malas', 'Tokuno', 'Ter Mur'];
const WORLD_MAP_MIN_WIDTH = 640;
const WORLD_MAP_MIN_HEIGHT = 420;
const WORLD_MAP_TABS_HEIGHT = 28;
const WORLD_MAP_FOOTER_HEIGHT = 32;
const WORLD_MAP_MAX_ZOOM = 8;

function facetName(index) {
  return WORLD_MAP_FACETS[index] || `Map ${index}`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class WorldMapWindow {
  constructor(world) {
    this.world = world;
    this.saved = loadSaved(world, WORLD_MAP_STORAGE_BASE);
    const defaultWidth = Math.min(1120, Math.max(WORLD_MAP_MIN_WIDTH, window.innerWidth - 80));
    const defaultHeight = Math.min(800, Math.max(WORLD_MAP_MIN_HEIGHT, window.innerHeight - 120));
    this.width = Math.round(Number(this.saved.width) || defaultWidth);
    this.height = Math.round(Number(this.saved.height) || defaultHeight);
    this.facet = clampNumber(Math.floor(Number(this.saved.facet) || 0), 0, this.facetCount - 1);
    this.zoom = clampNumber(Number(this.saved.zoom) || 1, 1, WORLD_MAP_MAX_ZOOM);
    const savedX = Number(this.saved.x);
    const savedY = Number(this.saved.y);
    this.x = Number.isFinite(savedX) ? savedX : Math.max(20, (window.innerWidth - this.width) / 2);
    this.y = Number.isFinite(savedY) ? savedY : Math.max(20, (window.innerHeight - this.height) / 2);
    this.centerX = null;
    this.centerY = null;
    this.image = null;
    this.loadToken = 0;
    this.loading = false;
    this.failed = false;
    this.dragging = false;
    this.moving = false;
    this.resizing = false;
    this.dragMoved = false;
    this.dragStart = null;
    this.hoverTile = null;
    this.cursorTile = null;
    this.hoverButton = null;
    this.clampSize();
    this.clampPosition();
    this.loadFacet(this.facet, true, true);
  }

  get facetCount() {
    const count = Number(this.world.config?.mapCount) || this.world.config?.maps?.length || 6;
    return Math.max(1, count);
  }

  facetSize(facet) {
    const sizes = this.world.config?.maps;
    const size = Array.isArray(sizes) ? sizes[facet] : null;
    if (Array.isArray(size) && size[0] > 0 && size[1] > 0) return size;
    return [7168, 4096];
  }

  get canCloseWithEsc() {
    return true;
  }

  get mapRect() {
    return {
      x: this.x + MAP_MARGIN,
      y: this.y + TITLE_HEIGHT + WORLD_MAP_TABS_HEIGHT + 4,
      w: Math.max(1, this.width - MAP_MARGIN * 2),
      h: Math.max(1, this.height - TITLE_HEIGHT - WORLD_MAP_TABS_HEIGHT - WORLD_MAP_FOOTER_HEIGHT - MAP_MARGIN - 4),
    };
  }

  get footerY() {
    return this.y + this.height - WORLD_MAP_FOOTER_HEIGHT;
  }

  get closeRect() {
    return { x: this.x + this.width - 22, y: this.y + 3, w: 18, h: 16 };
  }

  get resizeRect() {
    return { x: this.x + this.width - 14, y: this.y + this.height - 14, w: 12, h: 12 };
  }

  get tabButtons() {
    const count = this.facetCount;
    const gap = 4;
    const available = this.width - MAP_MARGIN * 2 - gap * (count - 1);
    const width = Math.max(34, Math.min(96, Math.floor(available / count)));
    const buttons = [];
    let x = this.x + MAP_MARGIN;
    for (let i = 0; i < count; i++) {
      const label = width >= 62 ? facetName(i) : facetName(i).slice(0, 3);
      buttons.push({
        id: `facet:${i}`,
        facet: i,
        label,
        x,
        y: this.y + TITLE_HEIGHT + 2,
        w: width,
        h: WORLD_MAP_TABS_HEIGHT - 6,
      });
      x += width + gap;
    }
    return buttons;
  }

  get footerButtons() {
    const height = 20;
    const y = this.y + this.height - WORLD_MAP_FOOTER_HEIGHT + 6;
    const specs = [
      { id: 'zoomOut', label: '-', w: 24 },
      { id: 'zoomIn', label: '+', w: 24 },
      { id: 'center', label: 'Center', w: 52 },
      { id: 'fit', label: 'Fit', w: 34 },
    ];
    let x = this.x + this.width - MAP_MARGIN;
    const buttons = [];
    for (const spec of specs) {
      x -= spec.w;
      buttons.push({ ...spec, x, y, h: height });
      x -= 4;
    }
    return buttons;
  }

  buttonAt(mx, my) {
    for (const button of this.tabButtons) {
      if (inside(button, mx, my)) return button;
    }
    for (const button of this.footerButtons) {
      if (inside(button, mx, my)) return button;
    }
    return null;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  clampSize() {
    const maxW = Math.max(240, window.innerWidth - 20);
    const maxH = Math.max(180, window.innerHeight - 20);
    this.width = Math.round(clampNumber(this.width, Math.min(WORLD_MAP_MIN_WIDTH, maxW), maxW));
    this.height = Math.round(clampNumber(this.height, Math.min(WORLD_MAP_MIN_HEIGHT, maxH), maxH));
  }

  clampPosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  saveState() {
    saveSaved(this.world, WORLD_MAP_STORAGE_BASE, {
      x: Math.round(this.x),
      y: Math.round(this.y),
      width: Math.round(this.width),
      height: Math.round(this.height),
      facet: this.facet,
      zoom: Number(this.zoom.toFixed(2)),
    });
  }

  loadFacet(facet, resetView, keepZoom = false) {
    this.facet = facet;
    this.image = null;
    this.loading = true;
    this.failed = false;
    this.cursorTile = null;
    this.hoverTile = null;
    if (resetView) {
      this.centerX = null;
      this.centerY = null;
      if (!keepZoom) this.zoom = 1;
    }
    const token = ++this.loadToken;
    const [mapW, mapH] = this.facetSize(facet);
    const max = 1024;
    let outW = max;
    let outH = max;
    if (mapW >= mapH) outH = Math.max(1, Math.round((max * mapH) / mapW));
    else outW = Math.max(1, Math.round((max * mapW) / mapH));
    const params = new URLSearchParams({
      facet: String(facet),
      x0: '0',
      y0: '0',
      x1: String(mapW),
      y1: String(mapH),
      w: String(outW),
      h: String(outH),
    });
    const image = new Image();
    image.onload = () => {
      if (token !== this.loadToken) return;
      this.image = image;
      this.loading = false;
      if (this.centerX == null || this.centerY == null) this.centerOnPlayer();
      this.clampView();
    };
    image.onerror = () => {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.failed = true;
    };
    image.src = this.world.assets.url(`/api/mapimage?${params}`);
  }

  centerOnPlayer() {
    const [mapW, mapH] = this.facetSize(this.facet);
    const player = this.world.player;
    if (player && this.facet === this.world.mapIndex) {
      this.centerX = player.renderX ?? player.x;
      this.centerY = player.renderY ?? player.y;
    } else {
      this.centerX = mapW / 2;
      this.centerY = mapH / 2;
    }
  }

  viewMetrics() {
    const area = this.mapRect;
    if (!this.image || !this.image.width || !this.image.height) return null;
    if (this.centerX == null || this.centerY == null) this.centerOnPlayer();
    const [mapW, mapH] = this.facetSize(this.facet);
    const fit = Math.min(area.w / this.image.width, area.h / this.image.height);
    const scale = fit * this.zoom;
    const dw = this.image.width * scale;
    const dh = this.image.height * scale;
    const pxPerTileX = dw / mapW;
    const pxPerTileY = dh / mapH;
    return {
      area,
      mapW,
      mapH,
      dw,
      dh,
      pxPerTileX,
      pxPerTileY,
      originX: area.x + area.w / 2 - this.centerX * pxPerTileX,
      originY: area.y + area.h / 2 - this.centerY * pxPerTileY,
    };
  }

  clampView() {
    const m = this.viewMetrics();
    if (!m) return;
    if (this.centerX == null || this.centerY == null) this.centerOnPlayer();
    if (m.dw <= m.area.w) {
      this.centerX = m.mapW / 2;
    } else {
      const margin = m.area.w / 2 / m.pxPerTileX;
      this.centerX = clampNumber(this.centerX, margin, m.mapW - margin);
    }
    if (m.dh <= m.area.h) {
      this.centerY = m.mapH / 2;
    } else {
      const margin = m.area.h / 2 / m.pxPerTileY;
      this.centerY = clampNumber(this.centerY, margin, m.mapH - margin);
    }
  }

  tileAt(mx, my) {
    const m = this.viewMetrics();
    if (!m) return null;
    return {
      x: (mx - m.originX) / m.pxPerTileX,
      y: (my - m.originY) / m.pxPerTileY,
    };
  }

  tileToScreen(x, y) {
    const m = this.viewMetrics();
    if (!m) return null;
    return {
      x: m.originX + x * m.pxPerTileX,
      y: m.originY + y * m.pxPerTileY,
    };
  }

  invokeButton(id) {
    if (id.startsWith('facet:')) {
      this.selectFacet(Number(id.slice(6)));
    } else if (id === 'zoomIn') {
      this.setZoom(this.zoom * 1.25);
    } else if (id === 'zoomOut') {
      this.setZoom(this.zoom / 1.25);
    } else if (id === 'center') {
      this.centerOnPlayer();
      this.zoom = Math.max(this.zoom, 2);
      this.clampView();
      this.saveState();
    } else if (id === 'fit') {
      this.zoom = 1;
      this.clampView();
      this.saveState();
    }
  }

  setZoom(zoom) {
    const area = this.mapRect;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const before = this.tileAt(cx, cy);
    this.zoom = clampNumber(zoom, 1, WORLD_MAP_MAX_ZOOM);
    const after = this.tileAt(cx, cy);
    if (before && after) {
      this.centerX += before.x - after.x;
      this.centerY += before.y - after.y;
    }
    this.clampView();
    this.saveState();
  }

  selectFacet(facet) {
    if (!Number.isFinite(facet) || facet < 0 || facet >= this.facetCount || facet === this.facet) return;
    this.loadFacet(facet, true);
    this.saveState();
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (inside(this.closeRect, mx, my)) {
      this.close();
      return true;
    }
    if (inside(this.resizeRect, mx, my)) {
      this.resizing = true;
      this.dragStart = { mx, my, width: this.width, height: this.height };
      return true;
    }
    const control = this.buttonAt(mx, my);
    if (control) {
      this.invokeButton(control.id);
      return true;
    }
    if (inside(this.mapRect, mx, my)) {
      const m = this.viewMetrics();
      if (!m) return true;
      this.dragging = true;
      this.dragMoved = false;
      this.dragStart = {
        mx,
        my,
        centerX: this.centerX,
        centerY: this.centerY,
        px: m.pxPerTileX,
        py: m.pxPerTileY,
      };
      return true;
    }
    if (my < this.y + TITLE_HEIGHT) {
      this.moving = true;
      this.dragMoved = false;
      this.dragStart = { mx, my, x: this.x, y: this.y };
      return true;
    }
    return false;
  }

  onMouseMove(mx, my) {
    this.hoverButton = this.buttonAt(mx, my)?.id || null;
    if (this.resizing && this.dragStart) {
      this.width = this.dragStart.width + (mx - this.dragStart.mx);
      this.height = this.dragStart.height + (my - this.dragStart.my);
      this.dragMoved = true;
      this.clampSize();
      this.clampPosition();
      this.clampView();
      return;
    }
    if (this.moving && this.dragStart) {
      this.x = this.dragStart.x + (mx - this.dragStart.mx);
      this.y = this.dragStart.y + (my - this.dragStart.my);
      this.dragMoved = true;
      this.clampPosition();
      return;
    }
    if (this.dragging && this.dragStart) {
      const dx = mx - this.dragStart.mx;
      const dy = my - this.dragStart.my;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.dragMoved = true;
      this.centerX = this.dragStart.centerX - dx / this.dragStart.px;
      this.centerY = this.dragStart.centerY - dy / this.dragStart.py;
      this.clampView();
      return;
    }
    this.hoverTile = inside(this.mapRect, mx, my) ? this.tileAt(mx, my) : null;
  }

  onMouseUp(mx, my) {
    const wasDragging = this.dragging;
    if ((this.dragging || this.moving || this.resizing) && this.dragMoved) this.saveState();
    if (wasDragging && !this.dragMoved) {
      const tile = this.tileAt(mx, my);
      if (tile && inside(this.mapRect, mx, my)) {
        this.cursorTile = { x: Math.round(tile.x), y: Math.round(tile.y) };
      }
    }
    this.dragging = false;
    this.moving = false;
    this.resizing = false;
    this.dragStart = null;
    this.dragMoved = false;
  }

  onWheel(mx, my, deltaY) {
    if (!inside(this.mapRect, mx, my)) return false;
    const before = this.tileAt(mx, my);
    const factor = deltaY > 0 ? 1 / 1.25 : 1.25;
    this.zoom = clampNumber(this.zoom * factor, 1, WORLD_MAP_MAX_ZOOM);
    const after = this.tileAt(mx, my);
    if (before && after) {
      this.centerX += before.x - after.x;
      this.centerY += before.y - after.y;
    }
    this.clampView();
    this.saveState();
    return true;
  }

  onDoubleClick(mx, my) {
    if (this.buttonAt(mx, my) || !inside(this.mapRect, mx, my)) return;
    const tile = this.tileAt(mx, my);
    if (!tile || !this.world.player) return;
    if (this.facet !== this.world.mapIndex) {
      this.world.game.ui?.addJournal?.(`You are not on ${facetName(this.facet)}.`, '#c56a4a', true);
      return;
    }
    const [mapW, mapH] = this.facetSize(this.facet);
    const x = Math.round(clampNumber(tile.x, 0, mapW - 1));
    const y = Math.round(clampNumber(tile.y, 0, mapH - 1));
    this.cursorTile = { x, y };
    this.world.game.walkTo(x, y);
    this.world.game.ui?.addJournal?.(`Walking to ${x}, ${y}.`, '#b8a06a', true);
  }

  close() {
    this.saveState();
    this.world.game.ui?.closeWorldMap?.();
  }

  drawMarker(ctx, x, y, color, kind) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    if (kind === 'waypoint' || kind === 'quest') {
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 4, y);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, kind === 'player' ? 3.5 : 2.5, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    if (kind === 'player') {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMarkers(ctx) {
    const world = this.world;
    const player = world.player;
    if (player && this.facet === world.mapIndex) {
      const point = this.tileToScreen(player.renderX ?? player.x, player.renderY ?? player.y);
      if (point) this.drawMarker(ctx, point.x, point.y, '#ffffff', 'player');
    }
    if (this.facet === world.mapIndex && world.party?.members?.length) {
      for (const serial of world.party.members) {
        if (serial === world.playerSerial) continue;
        const entity = world.entities.get(serial);
        if (!entity || !entity.hasPosition) continue;
        const point = this.tileToScreen(entity.renderX ?? entity.x, entity.renderY ?? entity.y);
        if (point) this.drawMarker(ctx, point.x, point.y, '#7ee08a', 'party');
      }
    }
    for (const waypoint of [...(world.waypoints || []), ...(world.localWaypoints || [])]) {
      if (waypoint.map !== this.facet) continue;
      const point = this.tileToScreen(waypoint.x, waypoint.y);
      if (point) this.drawMarker(ctx, point.x, point.y, '#7fc7ff', 'waypoint');
    }
    const arrow = world.questArrow;
    if (arrow && this.facet === world.mapIndex) {
      const point = this.tileToScreen(arrow.x, arrow.y);
      if (point) this.drawMarker(ctx, point.x, point.y, '#ffd34a', 'quest');
    }
    if (this.cursorTile) {
      const point = this.tileToScreen(this.cursorTile.x, this.cursorTile.y);
      if (point) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(point.x - 5, point.y);
        ctx.lineTo(point.x + 5, point.y);
        ctx.moveTo(point.x, point.y - 5);
        ctx.lineTo(point.x, point.y + 5);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawResizeGrip(ctx) {
    const rect = this.resizeRect;
    ctx.strokeStyle = '#5f5133';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const offset = i * 4;
      ctx.moveTo(rect.x + rect.w - 2 - offset, rect.y + rect.h - 2);
      ctx.lineTo(rect.x + rect.w - 2, rect.y + rect.h - 2 - offset);
    }
    ctx.stroke();
  }

  draw(ctx) {
    drawWindowFrame(ctx, this.x, this.y, this.width, this.height, 'World Map', this.closeRect);

    for (const button of this.tabButtons) {
      drawButton(ctx, button, button.label, button.facet === this.facet);
    }

    const area = this.mapRect;
    ctx.fillStyle = '#080705';
    ctx.fillRect(area.x, area.y, area.w, area.h);

    const m = this.viewMetrics();
    if (this.image && m) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.x, area.y, area.w, area.h);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.image, m.originX, m.originY, m.dw, m.dh);
      this.drawMarkers(ctx);
      ctx.restore();
    } else {
      ctx.fillStyle = '#8d7a52';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        this.failed ? 'No world map art available.' : 'Loading world map...',
        area.x + area.w / 2,
        area.y + area.h / 2
      );
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    ctx.strokeStyle = '#4d4228';
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1);

    const footerY = this.footerY;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(this.x + 1, footerY, this.width - 2, WORLD_MAP_FOOTER_HEIGHT - 1);
    const player = this.world.player;
    let coords = '--';
    if (this.hoverTile) coords = `${Math.round(this.hoverTile.x)}, ${Math.round(this.hoverTile.y)}`;
    else if (player && this.facet === this.world.mapIndex) coords = `${player.x}, ${player.y}`;
    ctx.fillStyle = '#9e8e65';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `${facetName(this.facet)} · ${coords} · ${this.zoom.toFixed(2)}x`,
      this.x + MAP_MARGIN,
      footerY + WORLD_MAP_FOOTER_HEIGHT / 2
    );

    for (const button of this.footerButtons) {
      drawButton(ctx, button, button.label, false);
    }
    this.drawResizeGrip(ctx);
  }
}
