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

let radar16 = null;
let radarBytes = null;
let radarPromise = null;
const radarWaiters = new Set();
const staticCache = new WeakMap();

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

function radarColorData(onReady) {
  if (radar16 !== null) {
    if (radar16.length) onReady?.();
    return radar16;
  }
  if (onReady) radarWaiters.add(onReady);
  if (!radarPromise) {
    radarPromise = fetch('/api/radarcol')
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => {
        if (!buffer) {
          radar16 = new Uint16Array(0);
        } else {
          const view = new DataView(buffer);
          radar16 = new Uint16Array(Math.floor(buffer.byteLength / 2));
          for (let i = 0; i < radar16.length; i++) radar16[i] = view.getUint16(i * 2, true);
        }
        radarBytes = buildRadarBytes(radar16);
      })
      .catch(() => {
        radar16 = new Uint16Array(0);
        radarBytes = buildRadarBytes(radar16);
      })
      .finally(() => {
        for (const callback of radarWaiters) callback();
        radarWaiters.clear();
      });
  }
  return radar16 || new Uint16Array(0);
}

function hasRadarColor(index) {
  return !!radar16 && index < radar16.length && radar16[index] !== 0;
}

function fallbackColor(index, isStatic) {
  const hash = Math.imul(index + 1, 2654435761) >>> 0;
  if (isStatic) {
    return [140 + (hash & 0x1f), 130 + ((hash >> 8) & 0x1f), 110 + ((hash >> 16) & 0x1f)];
  }
  return [45 + (hash & 0x1f), 80 + ((hash >> 8) & 0x3f), 45 + ((hash >> 16) & 0x1f)];
}

function colorFor(index, isStatic) {
  if (hasRadarColor(index)) {
    const p = index * 3;
    return [radarBytes[p], radarBytes[p + 1], radarBytes[p + 2]];
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
    radarColorData(() => {
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

  onDoubleClick() {
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
            if (staticIndex && statics.zs[i] >= cell.z && hasRadarColor(staticIndex)) {
              index = staticIndex;
              isStatic = true;
            }
          }
          const [r, g, b] = colorFor(index, isStatic);
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
      if (!entity.isMobile || entity === player || !entity.hasPosition) continue;
      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      const gx = cx + (dx - dy) * scale;
      const gy = cy + (dx + dy) * scale;
      if (gx < area.x || gy < area.y || gx >= area.x + area.w || gy >= area.y + area.h) continue;
      ctx.fillStyle = notorietyColor(entity.notoriety);
      ctx.fillRect(Math.round(gx), Math.round(gy), 2, 2);
    }

    for (const waypoint of this.world.waypoints || []) {
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
    image.src = `/api/mapimage?${params}`;
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
