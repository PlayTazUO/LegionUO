import { settings } from './settings.js';

const STORAGE_BASE = 'legionuo.waypoints.v1';
const WINDOW_STORAGE_BASE = 'legionuo.waypoints.window.v1';
const WINDOW_WIDTH = 360;
const WINDOW_HEIGHT = 340;
const ROW_HEIGHT = 22;
const LIST_TOP = 98;
const BADGE_COLORS = {
  quest: '#ffd34a',
  server: '#7fc7ff',
  local: '#7ee08a',
};
const BADGE_LABELS = {
  quest: 'Q',
  server: 'S',
  local: 'L',
};

function storageKey(world, base) {
  const account = (world.game?.loginCredentials?.account || '').trim().toLowerCase();
  return account ? `${base}.${account}` : base;
}

function clampPosition(x, y, width, height) {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - height))),
  };
}

function fitText(ctx, text, maxWidth) {
  const value = String(text ?? '');
  if (!value || maxWidth <= 0) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;
  const suffix = '...';
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(value.slice(0, mid) + suffix).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? value.slice(0, lo) + suffix : '';
}

function normalizeWaypoint(entry, index) {
  if (!entry || typeof entry !== 'object') return null;
  const x = Number(entry.x);
  const y = Number(entry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const map = Number(entry.map);
  return {
    id: String(entry.id || `wp-${Date.now()}-${index}`),
    name: String(entry.name || `Waypoint ${index + 1}`).slice(0, 60),
    x: Math.round(x),
    y: Math.round(y),
    map: Number.isFinite(map) ? Math.round(map) : 0,
  };
}

export function loadLocalWaypoints(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(world, STORAGE_BASE)) || 'null');
    const list = Array.isArray(saved) ? saved : Array.isArray(saved?.waypoints) ? saved.waypoints : [];
    return list.map(normalizeWaypoint).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveLocalWaypoints(world, list) {
  const clean = (Array.isArray(list) ? list : []).map(normalizeWaypoint).filter(Boolean);
  world.localWaypoints = clean;
  try {
    localStorage.setItem(storageKey(world, STORAGE_BASE), JSON.stringify(clean));
  } catch {
    /* ignore quota errors */
  }
  return clean;
}

export function addLocalWaypoint(world, name = '', x = null, y = null) {
  const player = world.player;
  if (!player) return null;
  const list = [...(world.localWaypoints || [])];
  const waypointX = x != null && Number.isFinite(Number(x)) ? Math.round(Number(x)) : player.x;
  const waypointY = y != null && Number.isFinite(Number(y)) ? Math.round(Number(y)) : player.y;
  const waypoint = {
    id: `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(name || '').trim().slice(0, 60) || `Waypoint ${list.length + 1}`,
    x: waypointX,
    y: waypointY,
    map: world.mapIndex,
  };
  list.push(waypoint);
  saveLocalWaypoints(world, list);
  return waypoint;
}

export function removeLocalWaypoint(world, id) {
  const list = (world.localWaypoints || []).filter((waypoint) => waypoint.id !== id);
  saveLocalWaypoints(world, list);
}

export function clearLocalWaypoints(world) {
  saveLocalWaypoints(world, []);
}

function waypointDistance(world, entry) {
  const player = world.player;
  if (!player || entry.map !== world.mapIndex) return null;
  return Math.round(Math.hypot(entry.x - player.x, entry.y - player.y));
}

export class WaypointWindow {
  constructor(world) {
    this.world = world;
    this.width = WINDOW_WIDTH;
    this.height = WINDOW_HEIGHT;
    const saved = this.loadPosition();
    const pos = clampPosition(saved?.x ?? Math.max(20, window.innerWidth - 400), saved?.y ?? 120, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    this.scroll = 0;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.hoverRow = -1;
  }

  loadPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(this.world, WINDOW_STORAGE_BASE)) || 'null');
      if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
      return { x: Number(saved.x), y: Number(saved.y) };
    } catch {
      return null;
    }
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    try {
      localStorage.setItem(storageKey(this.world, WINDOW_STORAGE_BASE), JSON.stringify({ x: this.x, y: this.y }));
    } catch {
      /* ignore quota errors */
    }
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 27, y: this.y + 8, w: 18, h: 18 };
  }

  toggleRects() {
    return [
      { key: 'waypoints', label: 'Markers', x: this.x + 12, y: this.y + 36, w: 92, h: 18 },
      { key: 'questArrow', label: 'Quest arrow', x: this.x + 112, y: this.y + 36, w: 106, h: 18 },
    ];
  }

  addRect() {
    return { x: this.x + 12, y: this.y + 62, w: 96, h: 22 };
  }

  clearRect() {
    return { x: this.x + 116, y: this.y + 62, w: 96, h: 22 };
  }

  get entries() {
    const entries = [];
    const arrow = this.world.questArrow;
    if (arrow) {
      entries.push({
        kind: 'quest',
        id: 'quest',
        name: 'Quest target',
        x: arrow.x,
        y: arrow.y,
        map: this.world.mapIndex,
        serial: arrow.serial,
      });
    }
    for (const waypoint of this.world.waypoints || []) {
      entries.push({
        kind: 'server',
        id: `server-${waypoint.serial}`,
        name: `Waypoint ${waypoint.type ?? ''}`.trim(),
        x: waypoint.x,
        y: waypoint.y,
        map: waypoint.map,
        serial: waypoint.serial,
      });
    }
    for (const waypoint of this.world.localWaypoints || []) {
      entries.push({
        kind: 'local',
        id: waypoint.id,
        name: waypoint.name,
        x: waypoint.x,
        y: waypoint.y,
        map: waypoint.map,
      });
    }
    return entries;
  }

  get listRect() {
    return {
      x: this.x + 8,
      y: this.y + LIST_TOP,
      w: this.width - 16,
      h: this.height - LIST_TOP - 8,
    };
  }

  get visibleRows() {
    return Math.max(0, Math.floor(this.listRect.h / ROW_HEIGHT));
  }

  get maxScroll() {
    return Math.max(0, this.entries.length - this.visibleRows);
  }

  rowRects() {
    const list = this.listRect;
    const entries = this.entries.slice(this.scroll, this.scroll + this.visibleRows);
    return entries.map((entry, index) => ({
      ...entry,
      x: list.x,
      y: list.y + index * ROW_HEIGHT,
      w: list.w,
      h: ROW_HEIGHT,
    }));
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  removeRect(row) {
    return { x: row.x + row.w - 20, y: row.y + 4, w: 15, h: 14 };
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    for (const toggle of this.toggleRects()) {
      if (this.hitRect(toggle, mx, my)) {
        settings.toggle(toggle.key);
        return true;
      }
    }
    if (this.hitRect(this.addRect(), mx, my)) {
      this.addWaypoint();
      return true;
    }
    if (this.hitRect(this.clearRect(), mx, my)) {
      this.clearWaypoints();
      return true;
    }
    for (const row of this.rowRects()) {
      if (!this.hitRect(row, mx, my)) continue;
      if (row.kind === 'local' && this.hitRect(this.removeRect(row), mx, my)) {
        removeLocalWaypoint(this.world, row.id);
        this.world.game.ui?.addJournal(`Removed waypoint ${row.name}.`, '#b8a06a', true);
        return true;
      }
      break;
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
      return;
    }
    this.hoverRow = this.rowRects().findIndex((row) => this.hitRect(row, mx, my));
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  onDoubleClick(mx, my) {
    const row = this.rowRects().find((entry) => this.hitRect(entry, mx, my));
    if (row) this.walkTo(row);
  }

  onWheel(mx, my, deltaY) {
    if (!this.contains(mx, my)) return false;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + (deltaY > 0 ? 1 : -1)));
    return true;
  }

  close() {
    this.savePosition();
    this.world.game.ui?.closeWaypoints?.();
  }

  addWaypoint() {
    const list = this.world.localWaypoints || [];
    const ui = this.world.game.ui;
    ui?.showModalInput?.(
      'Add Waypoint',
      `Waypoint ${list.length + 1}`,
      60,
      (value) => {
        const waypoint = addLocalWaypoint(this.world, value);
        if (!waypoint) return;
        this.scroll = Math.max(0, this.maxScroll);
        ui.addJournal(`Added waypoint ${waypoint.name} at ${waypoint.x}, ${waypoint.y}.`, '#b8a06a', true);
      },
      true
    );
  }

  clearWaypoints() {
    const count = (this.world.localWaypoints || []).length;
    clearLocalWaypoints(this.world);
    this.scroll = 0;
    this.world.game.ui?.addJournal(
      count ? `Cleared ${count} local waypoint${count === 1 ? '' : 's'}.` : 'No local waypoints to clear.',
      '#b8a06a',
      true
    );
  }

  walkTo(row) {
    const ui = this.world.game.ui;
    if (row.map !== this.world.mapIndex) {
      ui?.addJournal('That waypoint is on another facet.', '#c56a4a', true);
      return;
    }
    if (row.kind === 'quest') this.world.socket.out.clickQuestArrow(false);
    ui?.addJournal(`Walking to ${row.name} (${row.x}, ${row.y}).`, '#b8a06a', true);
    this.world.game.walkTo(row.x, row.y);
  }

  drawButton(ctx, rect, label, active = false) {
    ctx.fillStyle = active ? 'rgba(201,176,108,0.28)' : 'rgba(0,0,0,0.28)';
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

  drawToggle(ctx, rect) {
    const on = !!settings.get(rect.key);
    const box = { x: rect.x, y: rect.y + 2, w: 14, h: 14 };
    ctx.fillStyle = on ? 'rgba(201,176,108,0.32)' : 'rgba(0,0,0,0.35)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = on ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    if (on) {
      ctx.strokeStyle = '#f0dfa8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(box.x + 3, box.y + 7);
      ctx.lineTo(box.x + 6, box.y + 10);
      ctx.lineTo(box.x + 11, box.y + 3);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = '#d9c58d';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(rect.label, rect.x + 20, rect.y + rect.h / 2 + 1);
    ctx.textBaseline = 'top';
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.96)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Waypoints', this.x + 12, this.y + 10);

    this.drawButton(ctx, this.closeRect(), 'X');

    for (const toggle of this.toggleRects()) this.drawToggle(ctx, toggle);
    this.drawButton(ctx, this.addRect(), 'Add here');
    this.drawButton(ctx, this.clearRect(), 'Clear local');

    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 12, this.y + 90, this.width - 24, 1);

    const entries = this.entries;
    if (!entries.length) {
      ctx.fillStyle = '#8d8060';
      ctx.font = '11px monospace';
      ctx.fillText('No quest target or waypoints.', this.x + 16, this.y + LIST_TOP + 8);
    }

    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll));
    const rows = this.rowRects();
    rows.forEach((row, index) => {
      const hovered = index === this.hoverRow;
      if (hovered) {
        ctx.fillStyle = 'rgba(201,176,108,0.10)';
        ctx.fillRect(row.x, row.y, row.w, row.h - 1);
      }
      const color = BADGE_COLORS[row.kind] || '#d9c58d';
      const badge = { x: row.x + 4, y: row.y + 4, w: 16, h: 14 };
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(badge.x, badge.y, badge.w, badge.h);
      ctx.strokeStyle = color;
      ctx.strokeRect(badge.x + 0.5, badge.y + 0.5, badge.w - 1, badge.h - 1);
      ctx.fillStyle = color;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(BADGE_LABELS[row.kind] || '?', badge.x + badge.w / 2, badge.y + badge.h / 2 + 1);

      const remove = row.kind === 'local' ? this.removeRect(row) : null;
      const rightPad = remove ? 26 : 8;
      const distance = waypointDistance(this.world, row);
      const meta = `${row.x}, ${row.y}${distance == null ? '' : `  ${distance}m`}`;
      ctx.font = '10px monospace';
      const metaWidth = ctx.measureText(meta).width;
      ctx.fillStyle = '#8d8060';
      ctx.textAlign = 'right';
      ctx.fillText(meta, row.x + row.w - rightPad, row.y + row.h / 2 + 1);

      ctx.fillStyle = row.kind === 'quest' ? '#e8d7a8' : '#d9c58d';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, row.name, row.w - 32 - metaWidth - rightPad), row.x + 26, row.y + row.h / 2 + 1);

      if (remove) this.drawButton(ctx, remove, 'X');
    });

    if (this.maxScroll > 0) {
      const list = this.listRect;
      const track = { x: list.x + list.w - 3, y: list.y, w: 3, h: list.h };
      const thumbHeight = Math.max(18, (this.visibleRows / entries.length) * track.h);
      const thumbY = track.y + (this.scroll / this.maxScroll) * (track.h - thumbHeight);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(track.x, track.y, track.w, track.h);
      ctx.fillStyle = 'rgba(206,184,126,0.65)';
      ctx.fillRect(track.x, thumbY, track.w, thumbHeight);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}
