import {
  Layer,
  baseBodyGraphic,
  buildEquipmentOrder,
  isFemaleMobile,
  isGargoyleBody,
} from './entity.js';
import { drawServerText } from './html.js';
import { settings } from './settings.js';
import { buffText } from './buffs.js';
import { hotbarSkillSlot, hotbarSpellSlot } from './hotbar.js';
import { SPELLS_PER_PAGE, getBookSpells, getCircleName, getSpellbookInfo, getSpellbookInfoByOffset } from './spells.js';
import { accountStorageKey, clampPosition, fitText, notorietyColor, viewportSize } from '../util/ui.js';

const CONTAINER_STORAGE_BASE = 'legionuo.container.v1';
const CONTAINER_MARGIN = 6;
const GRID_CELL = 46;
const GRID_INSET = 12;
const STACK_ART_OFFSET = 3;
const LIST_HEADER_HEIGHT = 20;
const LIST_ROW_HEIGHT = 24;
const LIST_MAX_ROWS = 8;
const LIST_ICON_SIZE = 20;
const MOBILE_PANEL_MARGIN = 8;
const MOBILE_HEADER_HEIGHT = 46;
const MOBILE_GRID_CELL = 58;
const MOBILE_GRID_GAP = 6;
const MOBILE_GRID_PAD = 8;
const MOBILE_SCROLLBAR_WIDTH = 8;
const SKILL_BUTTON_WIDTH = 128;
const SKILL_BUTTON_HEIGHT = 30;

function resolveItemName(world, item) {
  if (!item) return '';
  if (item.name) return item.name;
  const opl = world.opl.resolve(item.serial);
  if (opl?.name) return opl.name;
  const dataName = world.assets.staticName?.(item.graphic);
  if (dataName) return dataName;
  return `0x${item.graphic.toString(16)}`;
}

function containerStorageKey(world) {
  return accountStorageKey(world, CONTAINER_STORAGE_BASE);
}

function loadContainerPositions(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(containerStorageKey(world)) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveContainerPosition(world, serial, x, y, listCollapsed) {
  try {
    const all = loadContainerPositions(world);
    all[String(serial)] = { x: Math.round(x), y: Math.round(y), listCollapsed: !!listCollapsed };
    localStorage.setItem(containerStorageKey(world), JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}

export class ContainerWindow {
  constructor(world, serial, gumpId) {
    this.world = world;
    this.serial = serial >>> 0;
    this.gumpId = gumpId;
    const saved = loadContainerPositions(world)[String(this.serial)];
    const fallback = {
      x: Math.max(20, window.innerWidth - 260 - Math.random() * 120),
      y: 60 + Math.random() * 60,
    };
    const pos = clampPosition(saved?.x ?? fallback.x, saved?.y ?? fallback.y, 240, 220);
    this.x = pos.x;
    this.y = pos.y;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.scroll = 0;
    this.press = null;
    this.scrollDrag = false;
    this.listCollapsed = saved?.listCollapsed === true;
    this.listScroll = 0;
    this.listPress = null;
    this.listHover = -1;
    this.listScrollDrag = false;
    this.mobileGridScroll = 0;
    this.mobileScrollDrag = false;
    this.mobileSwipe = null;
    this.lastMobileView = this.mobileView;
    if (this.lastMobileView) this.layoutMobile();
    this.requestContentsOpl();
  }

  get mobileView() {
    return !!this.world.game?.ui?.mobileLayout && settings.get('mobileContainerView') !== false;
  }

  layoutMobile() {
    const vp = viewportSize();
    const width = this.width;
    const height = this.height;
    const step = (this.serial % 4) * 10;
    this.x = Math.max(MOBILE_PANEL_MARGIN, Math.round((vp.width - width) / 2) - step);
    this.y = Math.max(MOBILE_PANEL_MARGIN, Math.round((vp.height - height) / 2) - step);
  }

  syncMobileView() {
    const mobile = this.mobileView;
    if (mobile === this.lastMobileView) return;
    this.lastMobileView = mobile;
    this.mobileSwipe = null;
    this.mobileScrollDrag = false;
    if (mobile) this.layoutMobile();
    else {
      const pos = clampPosition(this.x, this.y, this.width, this.height);
      this.x = pos.x;
      this.y = pos.y;
    }
  }

  get item() {
    return this.world.getItem(this.serial);
  }

  get items() {
    const parent = this.world.get(this.serial);
    if (!parent) return [];
    return [...parent.items.values()].filter((it) => it.layer === Layer.Invalid && it !== this.world.player);
  }

  requestContentsOpl() {
    const serials = this.items.map((item) => item.serial);
    if (serials.length) this.world.opl.requestMany(serials);
  }

  background() {
    return this.world.assets.getGump(this.gumpId);
  }

  get width() {
    if (this.mobileView) {
      const vp = viewportSize();
      return Math.max(220, Math.min(400, vp.width - MOBILE_PANEL_MARGIN * 2));
    }
    return this.background()?.width || 240;
  }

  get height() {
    if (this.mobileView) {
      const vp = viewportSize();
      return Math.max(110, Math.min(280, (vp.height - 140) / 2));
    }
    return this.background()?.height || 220;
  }

  contains(mx, my) {
    if (mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height) return true;
    const list = this.listRect;
    return mx >= list.x && my >= list.y && mx < list.x + list.w && my < list.y + list.h;
  }

  // Containers normally place items with the server-provided item.x/item.y.
  // Older shards and synthetic test data sometimes send 0,0 for everything, so
  // fall back to the grid layout in that case.
  get usesServerPositions() {
    return this.items.some((it) => it.x > 0 || it.y > 0);
  }

  layoutItems() {
    const items = this.items;
    const layout = [];
    const left = GRID_INSET;
    const top = GRID_INSET;
    const right = Math.max(left, this.width - GRID_INSET);
    const bottom = Math.max(top, this.height - GRID_INSET);
    const clampEntry = (entry) => {
      entry.x = Math.max(left, Math.min(right - entry.w, entry.x));
      entry.y = Math.max(top, Math.min(bottom - entry.h, entry.y));
      const bounds = entry.bounds;
      entry.hitX = entry.x + (bounds?.x || 0);
      entry.hitY = entry.y + (bounds?.y || 0);
      entry.hitW = bounds?.w ?? entry.w;
      entry.hitH = bounds?.h ?? entry.h;
      return entry;
    };
    if (this.usesServerPositions) {
      for (const item of items) {
        const img = this.world.assets.getStatic(item.graphic, item.hue);
        layout.push(
          clampEntry({
            item,
            img,
            bounds: this.world.assets.staticBounds(item.graphic, item.hue),
            x: item.x || GRID_INSET,
            y: item.y || GRID_INSET,
            w: img?.width || 28,
            h: img?.height || 28,
          })
        );
      }
      layout.sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
      return layout;
    }
    const cols = Math.max(1, Math.floor((this.width - GRID_INSET * 2) / GRID_CELL));
    for (let i = 0; i < items.length; i++) {
      const x = GRID_INSET + (i % cols) * GRID_CELL;
      const y = GRID_INSET + Math.floor(i / cols) * GRID_CELL;
      layout.push({
        item: items[i],
        img: this.world.assets.getStatic(items[i].graphic, items[i].hue),
        x,
        y,
        w: GRID_CELL - 2,
        h: GRID_CELL - 2,
        hitX: x,
        hitY: y,
        hitW: GRID_CELL - 2,
        hitH: GRID_CELL - 2,
      });
    }
    return layout;
  }

  get viewHeight() {
    return this.height - CONTAINER_MARGIN * 2;
  }

  get scrollMax() {
    // Server-positioned containers clamp items inside the gump instead of
    // scrolling. The legacy grid fallback still scrolls when it overflows.
    if (this.usesServerPositions) return 0;
    const layout = this.layoutItems();
    const content = layout.reduce((max, e) => Math.max(max, e.y + e.h), 0);
    return Math.max(0, content - this.viewHeight + CONTAINER_MARGIN);
  }

  get listWidth() {
    return this.width;
  }

  get listVisibleRows() {
    return Math.min(LIST_MAX_ROWS, this.items.length);
  }

  get listBodyHeight() {
    return this.listCollapsed ? 0 : this.listVisibleRows * LIST_ROW_HEIGHT;
  }

  get listHeight() {
    return LIST_HEADER_HEIGHT + this.listBodyHeight;
  }

  get listTop() {
    return this.y + this.height;
  }

  get listRect() {
    return { x: this.x, y: this.listTop, w: this.listWidth, h: this.listHeight };
  }

  get listHeaderRect() {
    return { x: this.x, y: this.listTop, w: this.listWidth, h: LIST_HEADER_HEIGHT };
  }

  get listBodyRect() {
    return { x: this.x, y: this.listTop + LIST_HEADER_HEIGHT, w: this.listWidth, h: this.listBodyHeight };
  }

  get listToggleRect() {
    return { x: this.x + this.listWidth - 20, y: this.listTop + 3, w: 14, h: 14 };
  }

  get listSortedItems() {
    return [...this.items].sort((a, b) => {
      const an = resolveItemName(this.world, a).toLowerCase();
      const bn = resolveItemName(this.world, b).toLowerCase();
      return an.localeCompare(bn) || (a.serial >>> 0) - (b.serial >>> 0);
    });
  }

  get listScrollMax() {
    if (this.listCollapsed) return 0;
    return Math.max(0, this.items.length * LIST_ROW_HEIGHT - this.listBodyHeight);
  }

  get listScrollbarRect() {
    return {
      x: this.x + this.listWidth - 7,
      y: this.listTop + LIST_HEADER_HEIGHT + 2,
      w: 4,
      h: Math.max(0, this.listBodyHeight - 4),
    };
  }

  listScrollbarThumb() {
    const track = this.listScrollbarRect;
    if (this.listScrollMax <= 0 || track.h <= 0) return null;
    const ratio = this.listBodyHeight / (this.items.length * LIST_ROW_HEIGHT);
    const h = Math.max(16, track.h * ratio);
    const top = track.y + (this.listScroll / this.listScrollMax) * (track.h - h);
    return { x: track.x, y: top, w: track.w, h };
  }

  setListScrollFromMouse(my) {
    const track = this.listScrollbarRect;
    const thumb = this.listScrollbarThumb();
    if (!thumb) return;
    const travel = track.h - thumb.h;
    if (travel <= 0) return;
    const ratio = Math.max(0, Math.min(1, (my - track.y - thumb.h / 2) / travel));
    this.listScroll = ratio * this.listScrollMax;
  }

  get mobileHeaderRect() {
    return { x: this.x, y: this.y, w: this.width, h: MOBILE_HEADER_HEIGHT };
  }

  get mobileBodyRect() {
    return {
      x: this.x,
      y: this.y + MOBILE_HEADER_HEIGHT,
      w: this.width,
      h: Math.max(0, this.height - MOBILE_HEADER_HEIGHT),
    };
  }

  get mobileCloseRect() {
    return { x: this.x + this.width - 42, y: this.y + 6, w: 34, h: 34 };
  }

  get mobileGridColumns() {
    const body = this.mobileBodyRect;
    const available = body.w - MOBILE_GRID_PAD * 2 - MOBILE_SCROLLBAR_WIDTH - 6;
    return Math.max(
      1,
      Math.floor((available + MOBILE_GRID_GAP) / (MOBILE_GRID_CELL + MOBILE_GRID_GAP))
    );
  }

  get mobileGridStride() {
    return MOBILE_GRID_CELL + MOBILE_GRID_GAP;
  }

  get mobileGridContentWidth() {
    const cols = this.mobileGridColumns;
    return cols * MOBILE_GRID_CELL + (cols - 1) * MOBILE_GRID_GAP;
  }

  get mobileGridLeft() {
    const body = this.mobileBodyRect;
    const usable = body.w - (MOBILE_SCROLLBAR_WIDTH + 4);
    return body.x + Math.max(MOBILE_GRID_PAD, Math.floor((usable - this.mobileGridContentWidth) / 2));
  }

  get mobileGridRows() {
    return Math.ceil(this.items.length / this.mobileGridColumns);
  }

  get mobileGridContentHeight() {
    const rows = this.mobileGridRows;
    if (!rows) return 0;
    return rows * MOBILE_GRID_CELL + (rows - 1) * MOBILE_GRID_GAP;
  }

  get mobileGridHeight() {
    return Math.max(0, this.mobileBodyRect.h - MOBILE_GRID_PAD * 2);
  }

  get mobileScrollMax() {
    return Math.max(0, this.mobileGridContentHeight - this.mobileGridHeight);
  }

  get mobileScrollbarRect() {
    const body = this.mobileBodyRect;
    return {
      x: body.x + body.w - MOBILE_SCROLLBAR_WIDTH - 4,
      y: body.y + MOBILE_GRID_PAD,
      w: MOBILE_SCROLLBAR_WIDTH,
      h: Math.max(0, body.h - MOBILE_GRID_PAD * 2),
    };
  }

  mobileScrollbarThumb() {
    const track = this.mobileScrollbarRect;
    if (this.mobileScrollMax <= 0 || track.h <= 0) return null;
    const ratio = this.mobileGridHeight / this.mobileGridContentHeight;
    const h = Math.min(track.h, Math.max(32, track.h * ratio));
    const top = track.y + (this.mobileGridScroll / this.mobileScrollMax) * (track.h - h);
    return { x: track.x, y: top, w: track.w, h };
  }

  setMobileScrollFromMouse(my) {
    const track = this.mobileScrollbarRect;
    const thumb = this.mobileScrollbarThumb();
    if (!thumb) return;
    const travel = track.h - thumb.h;
    if (travel <= 0) return;
    const ratio = Math.max(0, Math.min(1, (my - track.y - thumb.h / 2) / travel));
    this.mobileGridScroll = ratio * this.mobileScrollMax;
  }

  mobileCellRect(index) {
    const body = this.mobileBodyRect;
    const cols = this.mobileGridColumns;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: this.mobileGridLeft + col * this.mobileGridStride,
      y: body.y + MOBILE_GRID_PAD + row * this.mobileGridStride - this.mobileGridScroll,
      w: MOBILE_GRID_CELL,
      h: MOBILE_GRID_CELL,
    };
  }

  mobileItemAt(mx, my) {
    const body = this.mobileBodyRect;
    if (mx < body.x || mx >= body.x + body.w || my < body.y || my >= body.y + body.h) return null;
    const localX = mx - this.mobileGridLeft;
    const localY = my - (body.y + MOBILE_GRID_PAD) + this.mobileGridScroll;
    if (localX < 0 || localY < 0) return null;
    const stride = this.mobileGridStride;
    const col = Math.floor(localX / stride);
    const row = Math.floor(localY / stride);
    if (col >= this.mobileGridColumns || row >= this.mobileGridRows) return null;
    if (localX - col * stride >= MOBILE_GRID_CELL || localY - row * stride >= MOBILE_GRID_CELL) return null;
    return this.listSortedItems[row * this.mobileGridColumns + col] || null;
  }

  listRowRect(index) {
    const body = this.listBodyRect;
    return {
      x: body.x + 2,
      y: body.y + index * LIST_ROW_HEIGHT - this.listScroll,
      w: body.w - 4,
      h: LIST_ROW_HEIGHT - 1,
    };
  }

  listRowIndexAt(mx, my) {
    if (this.listCollapsed) return -1;
    const body = this.listBodyRect;
    if (mx < body.x || mx >= body.x + body.w || my < body.y || my >= body.y + body.h) return -1;
    const index = Math.floor((my - body.y + this.listScroll) / LIST_ROW_HEIGHT);
    return index >= 0 && index < this.items.length ? index : -1;
  }

  listItemAt(mx, my) {
    const index = this.listRowIndexAt(mx, my);
    if (index < 0) return null;
    return this.listSortedItems[index] || null;
  }

  pointInList(mx, my) {
    const rect = this.listRect;
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  localPoint(mx, my) {
    return { x: mx - this.x, y: my - this.y + this.scroll };
  }

  hitBounds(entry) {
    const stacked = entry.item?.amount > 1 ? STACK_ART_OFFSET : 0;
    return { x: entry.hitX, y: entry.hitY, w: entry.hitW + stacked, h: entry.hitH + stacked };
  }

  itemAt(mx, my) {
    const layout = this.layoutItems();
    const p = this.localPoint(mx, my);
    for (let i = layout.length - 1; i >= 0; i--) {
      const e = layout[i];
      const b = this.hitBounds(e);
      if (p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h) return e.item;
    }
    return null;
  }

  targetAt(mx, my) {
    if (!this.contains(mx, my)) return null;
    if (this.mobileView) return this.mobileItemAt(mx, my);
    return this.listItemAt(mx, my) || this.itemAt(mx, my);
  }

  tooltipAt(mx, my) {
    const item = this.mobileView
      ? this.mobileItemAt(mx, my)
      : this.listItemAt(mx, my) || this.itemAt(mx, my);
    if (!item) return null;
    return { id: `container:${this.serial}:${item.serial}`, serial: item.serial, title: resolveItemName(this.world, item) };
  }

  get scrollbarRect() {
    return { x: this.x + this.width - 12, y: this.y + CONTAINER_MARGIN, w: 6, h: this.height - CONTAINER_MARGIN * 2 };
  }

  scrollbarThumb() {
    const track = this.scrollbarRect;
    if (this.scrollMax <= 0) return null;
    const ratio = this.viewHeight / (this.viewHeight + this.scrollMax);
    const h = Math.max(20, track.h * ratio);
    const top = track.y + (this.scroll / this.scrollMax) * (track.h - h);
    return { x: track.x, y: top, w: track.w, h };
  }

  setScrollFromMouse(my) {
    const track = this.scrollbarRect;
    const thumb = this.scrollbarThumb();
    if (!thumb) return;
    const travel = track.h - thumb.h;
    if (travel <= 0) return;
    const ratio = Math.max(0, Math.min(1, (my - track.y - thumb.h / 2) / travel));
    this.scroll = ratio * this.scrollMax;
  }

  onMouseDown(mx, my, button, event) {
    if (this.mobileView) return this.onMobileMouseDown(mx, my, button, event);
    this.listPress = null;
    this.press = null;
    if (button === 2) {
      const item = this.listItemAt(mx, my) || this.itemAt(mx, my);
      if (!item && !this.pointInList(mx, my)) this.close();
      return true;
    }
    if (button === 0 && this.listScrollMax > 0) {
      const thumb = this.listScrollbarThumb();
      if (
        thumb &&
        mx >= thumb.x - 2 &&
        mx < thumb.x + thumb.w + 2 &&
        my >= this.listScrollbarRect.y &&
        my < this.listScrollbarRect.y + this.listScrollbarRect.h
      ) {
        this.listScrollDrag = true;
        this.listPress = null;
        this.setListScrollFromMouse(my);
        return true;
      }
    }
    if (button === 0 && this.hitRect(this.listToggleRect, mx, my)) {
      this.toggleList();
      return true;
    }
    const listItem = this.listItemAt(mx, my);
    if (listItem) {
      if (!this.world.held) {
        this.listPress = { item: listItem, x: mx, y: my, moved: false, split: !!event?.shiftKey };
      }
      return true;
    }
    if (this.pointInList(mx, my)) {
      this.listPress = null;
      if (this.hitRect(this.listHeaderRect, mx, my)) {
        this.dragging = true;
        this.dragOffset.x = mx - this.x;
        this.dragOffset.y = my - this.y;
      }
      return true;
    }
    if (button === 0 && this.scrollMax > 0) {
      const thumb = this.scrollbarThumb();
      if (thumb && mx >= thumb.x - 2 && mx < thumb.x + thumb.w + 2 && my >= this.scrollbarRect.y && my < this.scrollbarRect.y + this.scrollbarRect.h) {
        this.scrollDrag = true;
        this.press = null;
        this.setScrollFromMouse(my);
        return true;
      }
    }
    const item = this.itemAt(mx, my);
    if (item) {
      if (button === 0 && !this.world.held) {
        this.press = { item, x: mx, y: my, moved: false, split: !!event?.shiftKey };
      }
      return true;
    }
    this.press = null;
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMobileMouseDown(mx, my, button, event) {
    this.listPress = null;
    this.mobileSwipe = null;
    if (button === 2) {
      if (!this.mobileItemAt(mx, my)) this.close();
      return true;
    }
    if (this.hitRect(this.mobileCloseRect, mx, my)) {
      this.close();
      return true;
    }
    if (button === 0 && this.mobileScrollMax > 0) {
      const track = this.mobileScrollbarRect;
      if (
        mx >= track.x - 6 &&
        mx < track.x + track.w + 6 &&
        my >= track.y &&
        my < track.y + track.h
      ) {
        this.mobileScrollDrag = true;
        this.setMobileScrollFromMouse(my);
        return true;
      }
    }
    const item = this.mobileItemAt(mx, my);
    if (item) {
      if (!this.world.held) {
        this.listPress = { item, x: mx, y: my, moved: false, split: !!event?.shiftKey };
      }
      return true;
    }
    if (this.hitRect(this.mobileHeaderRect, mx, my)) {
      this.dragging = true;
      this.dragOffset.x = mx - this.x;
      this.dragOffset.y = my - this.y;
      return true;
    }
    const body = this.mobileBodyRect;
    if (this.hitRect(body, mx, my)) {
      this.mobileSwipe = { y: my, start: this.mobileGridScroll };
    }
    return true;
  }

  onMobileMouseMove(mx, my, event) {
    if (this.mobileScrollDrag) {
      this.setMobileScrollFromMouse(my);
      return;
    }
    if (this.mobileSwipe) {
      const dy = my - this.mobileSwipe.y;
      this.mobileGridScroll = Math.max(
        0,
        Math.min(this.mobileSwipe.start - dy, this.mobileScrollMax)
      );
      return;
    }
    if (this.listPress && !this.listPress.moved) {
      const dx = mx - this.listPress.x;
      const dy = my - this.listPress.y;
      if (dx * dx + dy * dy >= 16) {
        this.listPress.moved = true;
        if (this.mobileScrollMax > 0 && Math.abs(dy) > Math.abs(dx)) {
          this.mobileSwipe = { y: this.listPress.y, start: this.mobileGridScroll };
          this.listPress = null;
          this.mobileGridScroll = Math.max(
            0,
            Math.min(this.mobileSwipe.start - dy, this.mobileScrollMax)
          );
          return;
        }
        this.mobileSwipe = null;
        if (!this.world.held) {
          const item = this.listPress.item;
          if ((this.listPress.split || event?.shiftKey) && item.amount > 1) {
            this.promptSplit(item);
            return;
          }
          this.pickupItem(item);
        }
      }
    }
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMobileMouseUp(mx, my) {
    this.mobileScrollDrag = false;
    this.mobileSwipe = null;
    if (this.dragging) this.savePosition();
    this.dragging = false;
    if (this.listPress && !this.listPress.moved) {
      if (this.listPress.split && this.listPress.item.amount > 1) this.promptSplit(this.listPress.item);
      else {
        this.world.socket.out.singleClick(this.listPress.item.serial);
        this.world.game.ui.requestContextMenu(this.listPress.item.serial, mx, my);
      }
    }
    this.listPress = null;
    if (this.world.held && this.contains(mx, my)) this.dropHeld(mx, my);
  }

  onMouseUp(mx, my) {
    if (this.mobileView) return this.onMobileMouseUp(mx, my);
    this.scrollDrag = false;
    this.listScrollDrag = false;
    if (this.dragging) this.savePosition();
    this.dragging = false;
    if (this.listPress && !this.listPress.moved) {
      if (this.listPress.split && this.listPress.item.amount > 1) this.promptSplit(this.listPress.item);
      else {
        this.world.socket.out.singleClick(this.listPress.item.serial);
        this.world.game.ui.requestContextMenu(this.listPress.item.serial, mx, my);
      }
    }
    this.listPress = null;
    if (this.press && !this.press.moved) {
      if (this.press.split && this.press.item.amount > 1) this.promptSplit(this.press.item);
      else {
        this.world.socket.out.singleClick(this.press.item.serial);
        this.world.game.ui.requestContextMenu(this.press.item.serial, mx, my);
      }
    }
    this.press = null;
    if (this.world.held && this.contains(mx, my)) this.dropHeld(mx, my);
  }

  onItemDrop(mx, my) {
    if (!this.world.held || !this.contains(mx, my)) return false;
    this.dropHeld(mx, my);
    return true;
  }

  dropHeld(mx, my) {
    const item = this.world.held;
    if (!item) return;
    this.world.held = null;
    const p = this.localPoint(mx, my);
    const img = this.world.assets.getStatic(item.graphic, item.hue);
    const w = img?.width || 0;
    const h = img?.height || 0;
    const maxX = Math.max(0, this.width - w);
    const maxY = Math.max(0, this.height - h);
    const x = Math.max(0, Math.min(maxX, Math.round(p.x - w / 2)));
    const y = Math.max(0, Math.min(maxY, Math.round(p.y - h / 2)));
    this.world.socket.out.drop(item.serial, x, y, 0, 0, this.serial);
  }

  pickupItem(item, amount = item.amount || 1) {
    if (!item || this.world.held) return;
    const total = Math.max(1, item.amount || 1);
    const count = Math.max(1, Math.min(total, Math.round(Number(amount) || 1)));
    this.world.heldAmount = count;
    this.world.held = item;
    this.world.socket.out.pickup(item.serial, count);
  }

  promptSplit(item) {
    const total = item.amount || 1;
    if (total <= 1) {
      this.world.socket.out.singleClick(item.serial);
      return;
    }
    const ui = this.world.game.ui;
    if (!ui?.showModalInput) return;
    ui.dragTarget = null;
    this.press = null;
    this.listPress = null;
    ui.showModalInput(`Split ${resolveItemName(this.world, item) || 'stack'} (1-${total})`, '1', 6, (value) => {
      const parsed = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      this.pickupItem(item, parsed);
    });
  }

  onWheel(mx, my, deltaY) {
    if (this.mobileView) {
      if (!this.contains(mx, my)) return false;
      const step = deltaY > 0 ? this.mobileGridStride : -this.mobileGridStride;
      this.mobileGridScroll = Math.max(0, Math.min(this.mobileGridScroll + step, this.mobileScrollMax));
      return true;
    }
    if (this.pointInList(mx, my)) {
      if (this.listCollapsed || this.listScrollMax <= 0) return true;
      const step = deltaY > 0 ? LIST_ROW_HEIGHT : -LIST_ROW_HEIGHT;
      this.listScroll = Math.max(0, Math.min(this.listScroll + step, this.listScrollMax));
      return true;
    }
    if (!this.contains(mx, my)) return false;
    const step = deltaY > 0 ? GRID_CELL : -GRID_CELL;
    this.scroll = Math.max(0, Math.min(this.scroll + step, this.scrollMax));
    return true;
  }

  onMouseMove(mx, my, event) {
    if (this.mobileView) return this.onMobileMouseMove(mx, my, event);
    this.listHover = this.listRowIndexAt(mx, my);
    if (this.scrollDrag) {
      this.setScrollFromMouse(my);
      return;
    }
    if (this.listScrollDrag) {
      this.setListScrollFromMouse(my);
      return;
    }
    if (this.listPress && !this.listPress.moved) {
      const dx = mx - this.listPress.x;
      const dy = my - this.listPress.y;
      if (dx * dx + dy * dy >= 16) {
        this.listPress.moved = true;
        if (!this.world.held) {
          const item = this.listPress.item;
          if ((this.listPress.split || event?.shiftKey) && item.amount > 1) {
            this.promptSplit(item);
            return;
          }
          this.pickupItem(item);
        }
      }
    }
    if (this.press && !this.press.moved) {
      const dx = mx - this.press.x;
      const dy = my - this.press.y;
      if (dx * dx + dy * dy >= 16) {
        this.press.moved = true;
        if (!this.world.held) {
          const item = this.press.item;
          if ((this.press.split || event?.shiftKey) && item.amount > 1) {
            this.promptSplit(item);
            return;
          }
          this.pickupItem(item);
        }
      }
    }
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onDoubleClick(mx, my) {
    const item = this.mobileView
      ? this.mobileItemAt(mx, my)
      : this.listItemAt(mx, my) || this.itemAt(mx, my);
    if (item) this.world.socket.out.doubleClick(item.serial);
  }

  toggleList() {
    this.listCollapsed = !this.listCollapsed;
    this.listScroll = 0;
    this.listPress = null;
    this.listHover = -1;
    this.savePosition();
  }

  savePosition() {
    const width = this.mobileView ? this.width : 240;
    const height = this.mobileView ? this.height : 220;
    const pos = clampPosition(this.x, this.y, width, height);
    this.x = pos.x;
    this.y = pos.y;
    if (this.mobileView) return;
    saveContainerPosition(this.world, this.serial, this.x, this.y, this.listCollapsed);
  }

  close() {
    this.savePosition();
    this.world.game.ui.closeContainer(this.serial);
  }

  drawDebugHover(ctx) {
    if (!this.world.game?.debug) return;
    const ui = this.world.game.ui;
    const serial = ui?.hoverSerial;
    if (!serial) return;
    const mx = ui.mouse?.x ?? 0;
    const my = ui.mouse?.y ?? 0;
    let rect = null;
    if (this.mobileView) {
      const index = this.listSortedItems.findIndex((item) => item.serial === (serial >>> 0));
      if (index >= 0) {
        const cell = this.mobileCellRect(index);
        const body = this.mobileBodyRect;
        if (
          cell.y + cell.h > body.y + MOBILE_GRID_PAD &&
          cell.y < body.y + body.h - MOBILE_GRID_PAD
        ) {
          rect = cell;
        }
      }
    } else if (this.pointInList(mx, my)) {
      const index = this.listSortedItems.findIndex((item) => item.serial === (serial >>> 0));
      if (index >= 0 && !this.listCollapsed) {
        const row = this.listRowRect(index);
        const body = this.listBodyRect;
        if (row.y + row.h > body.y && row.y < body.y + body.h) rect = row;
      }
    } else if (this.contains(mx, my)) {
      const entry = this.layoutItems().find((item) => item.item.serial === (serial >>> 0));
      if (entry) {
        const b = this.hitBounds(entry);
        const x = this.x + b.x;
        const y = this.y + b.y - this.scroll;
        const top = this.y + CONTAINER_MARGIN;
        const bottom = top + this.viewHeight;
        if (y + b.h > top && y < bottom) rect = { x, y, w: b.w, h: b.h };
      }
    }
    if (!rect) return;
    ctx.save();
    ctx.strokeStyle = '#ff5fd2';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      Math.round(rect.x) + 0.5,
      Math.round(rect.y) + 0.5,
      Math.max(1, Math.round(rect.w)),
      Math.max(1, Math.round(rect.h))
    );
    ctx.restore();
  }

  draw(ctx, now) {
    this.syncMobileView();
    this.requestContentsOpl();
    if (this.mobileView) {
      this.drawMobile(ctx);
      this.drawDebugHover(ctx);
      return;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, this.scrollMax));
    const bg = this.background();
    if (bg) {
      ctx.drawImage(bg, this.x, this.y);
    } else {
      ctx.fillStyle = 'rgba(24,20,14,0.96)';
      ctx.fillRect(this.x, this.y, this.width, this.height);
      ctx.strokeStyle = '#8d7a52';
      ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    }
    const positioned = this.usesServerPositions;
    const layout = this.layoutItems();
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + CONTAINER_MARGIN, this.y + CONTAINER_MARGIN, this.width - CONTAINER_MARGIN * 2, this.viewHeight);
    ctx.clip();
    ctx.strokeStyle = 'rgba(198, 176, 126, 0.28)';
    ctx.lineWidth = 1;
    for (const e of layout) {
      const ix = this.x + e.x;
      const iy = this.y + e.y - this.scroll;
      const img = e.img;
      if (img) {
        const drawArt = (x, y) => {
          if (positioned) {
            ctx.drawImage(img, x, y);
          } else {
            const scale = Math.min(1, (e.w - 2) / Math.max(img.width, img.height));
            ctx.drawImage(
              img,
              x + (e.w - img.width * scale) / 2,
              y + (e.h - img.height * scale) / 2,
              img.width * scale,
              img.height * scale
            );
          }
        };
        drawArt(ix, iy);
        if (e.item.amount > 1) drawArt(ix + STACK_ART_OFFSET, iy + STACK_ART_OFFSET);
      }
      if (!positioned) ctx.strokeRect(ix + 0.5, iy + 0.5, e.w - 1, e.h - 1);
    }
    ctx.restore();

    const thumb = this.scrollbarThumb();
    if (thumb) {
      const track = this.scrollbarRect;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(track.x, track.y, track.w, track.h);
      ctx.fillStyle = 'rgba(206,184,126,0.72)';
      ctx.fillRect(thumb.x, thumb.y, thumb.w, thumb.h);
    }
    this.drawList(ctx);
    this.drawDebugHover(ctx);
  }

  drawMobile(ctx) {
    this.mobileGridScroll = Math.max(0, Math.min(this.mobileGridScroll, this.mobileScrollMax));
    const header = this.mobileHeaderRect;
    const body = this.mobileBodyRect;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(18,15,10,0.98)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.restore();
    ctx.strokeStyle = '#8d7a52';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = 'rgba(201,176,108,0.10)';
    ctx.fillRect(header.x + 1, header.y + 1, header.w - 2, header.h - 1);
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(header.x + 1, header.y + header.h - 1, header.w - 2, 1);

    const title = resolveItemName(this.world, this.item) || 'Container';
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fitText(ctx, title, this.width - 106), this.x + 12, this.y + 8);
    ctx.fillStyle = '#9e8e65';
    ctx.font = '10px monospace';
    ctx.fillText(
      `${this.items.length} item${this.items.length === 1 ? '' : 's'} - tap or drag`,
      this.x + 12,
      this.y + 28
    );

    const close = this.mobileCloseRect;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(close.x, close.y, close.w, close.h);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(close.x + 0.5, close.y + 0.5, close.w - 1, close.h - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', close.x + close.w / 2, close.y + close.h / 2 + 1);

    const items = this.listSortedItems;
    const cols = this.mobileGridColumns;
    const stride = this.mobileGridStride;

    ctx.save();
    ctx.beginPath();
    ctx.rect(body.x + 1, body.y, body.w - 2, body.h);
    ctx.clip();
    const firstRow = Math.max(0, Math.floor(this.mobileGridScroll / stride));
    const lastRow = Math.min(
      Math.ceil(this.mobileGridRows),
      Math.ceil((this.mobileGridScroll + this.mobileGridHeight) / stride) + 1
    );
    const first = firstRow * cols;
    const last = Math.min(items.length, lastRow * cols);

    for (let i = first; i < last; i++) {
      const item = items[i];
      const cell = this.mobileCellRect(i);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      ctx.strokeStyle = 'rgba(198,176,126,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1);

      const img = this.world.assets.getStatic(item.graphic, item.hue);
      if (img) {
        const artPad = 8;
        const scale = Math.min(1, (cell.w - artPad * 2) / Math.max(img.width, img.height));
        const iw = img.width * scale;
        const ih = img.height * scale;
        const ix = cell.x + (cell.w - iw) / 2;
        const iy = cell.y + (cell.h - ih) / 2;
        if (item.amount > 1) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.drawImage(img, ix + 3, iy + 3, iw, ih);
          ctx.restore();
        }
        ctx.drawImage(img, ix, iy, iw, ih);
      }

      if (item.amount > 1) {
        const count = String(item.amount);
        ctx.font = 'bold 10px monospace';
        const countWidth = ctx.measureText(count).width;
        const badgeW = Math.max(16, countWidth + 8);
        const badgeH = 14;
        const badgeX = cell.x + cell.w - badgeW - 3;
        const badgeY = cell.y + cell.h - badgeH - 3;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.fillStyle = '#ffe08a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);
      }
    }
    ctx.restore();

    const thumb = this.mobileScrollbarThumb();
    if (thumb) {
      const track = this.mobileScrollbarRect;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(track.x, track.y, track.w, track.h);
      ctx.fillStyle = 'rgba(206,184,126,0.72)';
      ctx.fillRect(thumb.x, thumb.y, thumb.w, thumb.h);
    }

    if (!items.length) {
      ctx.fillStyle = '#7b6d4d';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Empty container.', body.x + body.w / 2, body.y + 28);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  drawList(ctx) {
    this.listScroll = Math.max(0, Math.min(this.listScroll, this.listScrollMax));
    const rect = this.listRect;
    const header = this.listHeaderRect;

    ctx.fillStyle = 'rgba(16,14,10,0.97)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.fillStyle = 'rgba(201,176,108,0.10)';
    ctx.fillRect(header.x + 1, header.y + 1, header.w - 2, header.h - 1);
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(header.x + 1, header.y + header.h - 1, header.w - 2, 1);

    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d9c58d';
    ctx.fillText(`Items (${this.items.length})`, header.x + 8, header.y + header.h / 2 + 1);

    const toggle = this.listToggleRect;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(toggle.x, toggle.y, toggle.w, toggle.h);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(toggle.x + 0.5, toggle.y + 0.5, toggle.w - 1, toggle.h - 1);
    ctx.fillStyle = '#e2d6b4';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.listCollapsed ? '+' : '-', toggle.x + toggle.w / 2, toggle.y + toggle.h / 2 + 1);

    const body = this.listBodyRect;
    if (!this.listCollapsed && body.h > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(body.x + 1, body.y, body.w - 2, body.h);
      ctx.clip();
      const items = this.listSortedItems;
      const first = Math.max(0, Math.floor(this.listScroll / LIST_ROW_HEIGHT));
      const last = Math.min(items.length, Math.ceil((this.listScroll + body.h) / LIST_ROW_HEIGHT) + 1);
      for (let i = first; i < last; i++) {
        const item = items[i];
        const row = this.listRowRect(i);
        if (i === this.listHover) ctx.fillStyle = 'rgba(201,176,108,0.16)';
        else ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
        ctx.fillRect(row.x, row.y, row.w, row.h);

        const img = this.world.assets.getStatic(item.graphic, item.hue);
        if (img) {
          const scale = Math.min(1, LIST_ICON_SIZE / Math.max(img.width, img.height));
          const iw = img.width * scale;
          const ih = img.height * scale;
          ctx.drawImage(img, row.x + 4 + (LIST_ICON_SIZE - iw) / 2, row.y + (row.h - ih) / 2, iw, ih);
        }

        const name = resolveItemName(this.world, item);
        const countText = `x${item.amount || 1}`;
        ctx.font = '11px monospace';
        const countWidth = ctx.measureText(countText).width;
        const nameX = row.x + 4 + LIST_ICON_SIZE + 6;
        const nameWidth = Math.max(0, row.x + row.w - 8 - countWidth - 6 - nameX);
        if (
          !drawServerText(ctx, name, {
            x: nameX,
            y: row.y + 5,
            width: nameWidth,
            height: row.h - 8,
            defaultColor: '#e8d7a8',
            fontSize: 11,
            fontFamily: 'monospace',
            clip: true,
          })
        ) {
          ctx.fillStyle = '#e8d7a8';
          ctx.font = '11px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(fitText(ctx, name, nameWidth), nameX, row.y + row.h / 2 + 1);
        }

        ctx.fillStyle = item.amount > 1 ? '#ffe08a' : '#9e8e65';
        ctx.font = '11px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(countText, row.x + row.w - 8, row.y + row.h / 2 + 1);
      }
      ctx.restore();

      const listThumb = this.listScrollbarThumb();
      if (listThumb) {
        const track = this.listScrollbarRect;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(track.x, track.y, track.w, track.h);
        ctx.fillStyle = 'rgba(206,184,126,0.65)';
        ctx.fillRect(listThumb.x, listThumb.y, listThumb.w, listThumb.h);
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

const TRADE_STORAGE_BASE = 'legionuo.trade.v1';

function tradeStorageKey(world) {
  return accountStorageKey(world, TRADE_STORAGE_BASE);
}

function loadTradePosition(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(tradeStorageKey(world)) || 'null');
    if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
    return { x: Number(saved.x), y: Number(saved.y) };
  } catch {
    return null;
  }
}

const PARTY_STORAGE_BASE = 'legionuo.party.v1';
const PARTY_SIZE = 10;

function partyStorageKey(world) {
  return accountStorageKey(world, PARTY_STORAGE_BASE);
}

function loadPartyPosition(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(partyStorageKey(world)) || 'null');
    if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
    return { x: Number(saved.x), y: Number(saved.y) };
  } catch {
    return null;
  }
}

export class TradeWindow {
  constructor(world, trade) {
    this.world = world;
    this.trade = trade;
    this.width = 470;
    this.height = 340;
    const saved = loadTradePosition(world);
    const pos = clampPosition(
      saved?.x ?? Math.max(20, (window.innerWidth - this.width) / 2),
      saved?.y ?? 90,
      this.width,
      this.height
    );
    this.x = Math.round(pos.x);
    this.y = Math.round(pos.y);
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.press = null;
    this.scroll = { mine: 0, his: 0 };
    this.rowHeight = 26;
    this.panelHeight = 146;
  }

  collect(container) {
    const items = [];
    if (!container) return items;
    const seen = new Set();
    const add = (item) => {
      if (!item || seen.has(item.serial)) return;
      seen.add(item.serial);
      items.push(item);
    };
    const parent = this.world.get(container);
    if (parent?.items) for (const item of parent.items.values()) add(item);
    for (const entity of this.world.entities.values()) {
      if (entity.isItem && entity.container === container) add(entity);
    }
    items.sort((a, b) => a.serial - b.serial);
    return items;
  }

  get mine() {
    return this.collect(this.trade.myContainer);
  }

  get his() {
    return this.collect(this.trade.hisContainer);
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  panelRect(side) {
    const half = Math.floor(this.width / 2);
    return {
      x: side === 'mine' ? this.x + 14 : this.x + half + 6,
      y: this.y + 52,
      w: half - 20,
      h: this.panelHeight,
    };
  }

  scrollMax(side) {
    const items = side === 'mine' ? this.mine : this.his;
    return Math.max(0, items.length * this.rowHeight - (this.panelHeight - 8));
  }

  itemAt(mx, my) {
    for (const side of ['mine', 'his']) {
      const rect = this.panelRect(side);
      if (mx < rect.x || mx >= rect.x + rect.w || my < rect.y || my >= rect.y + rect.h) continue;
      const items = side === 'mine' ? this.mine : this.his;
      const top = rect.y + 4;
      const index = Math.floor((my - top + this.scroll[side]) / this.rowHeight);
      if (index >= 0 && index < items.length) return { item: items[index], side };
    }
    return null;
  }

  targetAt(mx, my) {
    if (!this.contains(mx, my)) return null;
    return this.itemAt(mx, my)?.item || null;
  }

  tooltipAt(mx, my) {
    const hit = this.itemAt(mx, my);
    if (!hit) return null;
    return { id: `trade:${this.trade.serial}:${hit.item.serial}`, serial: hit.item.serial, title: this.itemName(hit.item) };
  }

  itemName(item) {
    if (!this.world.opl.resolve(item.serial)) this.world.opl.request(item.serial);
    return resolveItemName(this.world, item);
  }

  closeRect() {
    return { x: this.x + this.width - 30, y: this.y + 8, w: 20, h: 20 };
  }

  goldRect(side, which) {
    return {
      x: side === 'mine' ? this.x + 14 : this.x + Math.floor(this.width / 2) + 6,
      y: this.y + (which === 'gold' ? 206 : 225),
      w: Math.floor(this.width / 2) - 20,
      h: 18,
    };
  }

  acceptRect() {
    return { x: this.x + 14, y: this.y + 252, w: 130, h: 26 };
  }

  cancelRect() {
    return { x: this.x + 14, y: this.y + 286, w: 130, h: 26 };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    if (this.hitRect(this.cancelRect(), mx, my)) {
      this.close();
      return true;
    }
    if (this.hitRect(this.acceptRect(), mx, my)) {
      this.toggleAccept();
      return true;
    }
    if (this.hitRect(this.goldRect('mine', 'gold'), mx, my)) {
      this.editGold('gold');
      return true;
    }
    if (this.hitRect(this.goldRect('mine', 'platinum'), mx, my)) {
      this.editGold('platinum');
      return true;
    }
    const hit = this.itemAt(mx, my);
    if (hit) {
      if (button === 0 && !this.world.held) this.press = { item: hit.item, x: mx, y: my, moved: false };
      return true;
    }
    this.press = null;
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (this.press && !this.press.moved) {
      const dx = mx - this.press.x;
      const dy = my - this.press.y;
      if (dx * dx + dy * dy >= 16) {
        this.press.moved = true;
        if (!this.world.held) {
          const item = this.press.item;
          this.world.held = item;
          this.world.socket.out.pickup(item.serial, item.amount || 1);
        }
      }
    }
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp(mx, my) {
    if (this.dragging) this.savePosition();
    this.dragging = false;
    if (this.press && !this.press.moved) this.world.socket.out.singleClick(this.press.item.serial);
    this.press = null;
  }

  onDoubleClick(mx, my) {
    const hit = this.itemAt(mx, my);
    if (hit) this.world.socket.out.doubleClick(hit.item.serial);
  }

  onWheel(mx, my, deltaY) {
    const step = deltaY > 0 ? this.rowHeight : -this.rowHeight;
    for (const side of ['mine', 'his']) {
      const rect = this.panelRect(side);
      if (mx < rect.x || mx >= rect.x + rect.w || my < rect.y || my >= rect.y + rect.h) continue;
      this.scroll[side] = Math.max(0, Math.min(this.scroll[side] + step, this.scrollMax(side)));
      return true;
    }
    return false;
  }

  onItemDrop(mx, my) {
    if (!this.world.held || !this.contains(mx, my)) return false;
    const rect = this.panelRect('mine');
    const item = this.world.held;
    const x = Math.max(0, Math.min(109, Math.round(mx - rect.x)));
    const y = Math.max(0, Math.min(79, Math.round(my - rect.y)));
    this.world.held = null;
    this.world.socket.out.drop(item.serial, x, y, 0, 0, this.trade.myContainer);
    return true;
  }

  toggleAccept() {
    this.trade.myAccepted = !this.trade.myAccepted;
    this.world.socket.out.tradeResponse(this.trade.myContainer, 2, this.trade.myAccepted);
  }

  editGold(which) {
    const current = which === 'gold' ? this.trade.myGold || 0 : this.trade.myPlatinum || 0;
    this.world.game.ui.showModalInput(`Offer ${which}`, String(current), 10, (value) => {
      let amount = Math.max(0, parseInt(String(value).replace(/[^0-9]/g, ''), 10) || 0);
      const maxGold = this.world.player?.gold;
      if (which === 'gold' && maxGold > 0) amount = Math.min(amount, maxGold);
      if (which === 'gold') this.trade.myGold = amount;
      else this.trade.myPlatinum = amount;
      this.world.socket.out.tradeGold(this.trade.myContainer, this.trade.myGold || 0, this.trade.myPlatinum || 0);
    }, true);
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = Math.round(pos.x);
    this.y = Math.round(pos.y);
    try {
      localStorage.setItem(tradeStorageKey(this.world), JSON.stringify({ x: this.x, y: this.y }));
    } catch {
      /* ignore quota errors */
    }
  }

  close() {
    this.savePosition();
    const ui = this.world.game.ui;
    this.world.socket.out.tradeResponse(this.trade.myContainer, 1, false);
    if (this.world.trade === this.trade) this.world.trade = null;
    ui?.onTradeChanged?.();
  }

  drawButton(ctx, rect, label, active) {
    ctx.fillStyle = active ? 'rgba(201,176,108,0.3)' : 'rgba(0,0,0,0.28)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = active ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.fillStyle = active ? '#f0dfa8' : '#d9c58d';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  drawPanel(ctx, side, label) {
    const rect = this.panelRect(side);
    const items = side === 'mine' ? this.mine : this.his;
    this.scroll[side] = Math.max(0, Math.min(this.scroll[side], this.scrollMax(side)));
    ctx.fillStyle = 'rgba(10,8,5,0.5)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    if (side === 'mine') {
      ctx.fillStyle = '#9e8e65';
      ctx.font = '10px monospace';
      ctx.fillText(label, rect.x + 3, rect.y - 16);
    } else {
      ctx.fillStyle = '#9e8e65';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(label, rect.x + rect.w - 3, rect.y - 16);
      ctx.textAlign = 'left';
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    const top = rect.y + 4 - this.scroll[side];
    if (!items.length) {
      ctx.fillStyle = '#6d6147';
      ctx.font = '11px monospace';
      ctx.fillText('No items offered', rect.x + 8, top + 6);
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowY = top + i * this.rowHeight;
      if (rowY + this.rowHeight < rect.y || rowY > rect.y + rect.h) continue;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.055)';
      ctx.fillRect(rect.x + 1, rowY, rect.w - 2, this.rowHeight - 1);
      const img = this.world.assets.getStatic(item.graphic, item.hue);
      if (img) {
        const scale = Math.min(1, 20 / Math.max(img.width, img.height));
        ctx.drawImage(
          img,
          rect.x + 5 + (20 - img.width * scale) / 2,
          rowY + 3 + (20 - img.height * scale) / 2,
          img.width * scale,
          img.height * scale
        );
      }
      ctx.fillStyle = '#e2d6b4';
      ctx.font = '11px monospace';
      let name = this.itemName(item);
      const amount = item.amount > 1 ? ` x${item.amount}` : '';
      const maxWidth = rect.w - 44;
      while (name.length > 3 && ctx.measureText(name + amount).width > maxWidth) name = name.slice(0, -2);
      ctx.fillText(name + amount, rect.x + 30, rowY + 7);
    }
    ctx.restore();
    if (this.scrollMax(side) > 0) {
      const trackX = rect.x + rect.w - 6;
      const thumbH = Math.max(20, ((rect.h - 8) * (rect.h - 8)) / (items.length * this.rowHeight));
      const maxScroll = this.scrollMax(side);
      const thumbY = rect.y + 4 + ((rect.h - 8 - thumbH) * this.scroll[side]) / Math.max(1, maxScroll);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(trackX, rect.y + 4, 3, rect.h - 8);
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(trackX, thumbY, 3, thumbH);
    }
  }

  drawGoldRow(ctx, side, which, value) {
    const rect = this.goldRect(side, which);
    const active = side === 'mine';
    if (active) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.fillStyle = active ? '#d9c58d' : '#9e8e65';
    ctx.font = '11px monospace';
    const label = which === 'gold' ? 'Gold' : 'Platinum';
    ctx.textAlign = 'left';
    ctx.fillText(`${label}: ${value || 0}`, rect.x + 4, rect.y + 4);
    if (active) {
      ctx.fillStyle = '#7d6f4d';
      ctx.textAlign = 'right';
      ctx.fillText('[edit]', rect.x + rect.w - 6, rect.y + 4);
      ctx.textAlign = 'left';
    }
  }

  draw(ctx) {
    const trade = this.trade;
    const playerName = this.world.player?.name || 'You';
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Secure Trade', this.x + 14, this.y + 10);
    this.drawButton(ctx, this.closeRect(), 'X', false);

    this.drawPanel(ctx, 'mine', playerName);
    this.drawPanel(ctx, 'his', trade.name || 'Other player');

    this.drawGoldRow(ctx, 'mine', 'gold', trade.myGold);
    this.drawGoldRow(ctx, 'his', 'gold', trade.hisGold);
    this.drawGoldRow(ctx, 'mine', 'platinum', trade.myPlatinum);
    this.drawGoldRow(ctx, 'his', 'platinum', trade.hisPlatinum);

    this.drawButton(ctx, this.acceptRect(), trade.myAccepted ? 'Accepted' : 'Accept', trade.myAccepted);
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = trade.hisAccepted ? '#9fd27a' : '#9e8e65';
    ctx.fillText(trade.hisAccepted ? 'They accepted' : 'Waiting...', this.x + this.width - 14, this.y + 260);
    this.drawButton(ctx, this.cancelRect(), 'Cancel', false);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#7d6f4d';
    ctx.font = '10px monospace';
    ctx.fillText('Drag items here; click gold to change', this.x + this.width - 14, this.y + 316);
    ctx.textAlign = 'left';
  }
}

export class PartyWindow {
  constructor(world) {
    this.world = world;
    this.width = 330;
    this.height = 366;
    const saved = loadPartyPosition(world);
    const pos = clampPosition(
      saved?.x ?? Math.max(20, (window.innerWidth - this.width) / 2),
      saved?.y ?? 100,
      this.width,
      this.height
    );
    this.x = Math.round(pos.x);
    this.y = Math.round(pos.y);
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  get party() {
    return this.world.party;
  }

  get members() {
    return this.party.members || [];
  }

  get inParty() {
    return this.members.length > 0;
  }

  get isLeader() {
    return !this.party.leader || this.party.leader === this.world.playerSerial;
  }

  memberAt(index) {
    const serial = this.members[index];
    return serial ? serial >>> 0 : 0;
  }

  memberName(serial) {
    if (serial === this.world.playerSerial) return this.world.player?.name || 'You';
    return this.world.getMobile(serial)?.name || `0x${(serial >>> 0).toString(16)}`;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  closeRect() {
    return { x: this.x + this.width - 30, y: this.y + 8, w: 20, h: 20 };
  }

  rowRect(index) {
    return { x: this.x + 10, y: this.y + 42 + index * 24, w: this.width - 20, h: 22 };
  }

  tellRect(index) {
    const row = this.rowRect(index);
    return { x: row.x + row.w - 50, y: row.y + 3, w: 20, h: 16 };
  }

  kickRect(index) {
    const row = this.rowRect(index);
    return { x: row.x + row.w - 24, y: row.y + 3, w: 20, h: 16 };
  }

  inviteRect() {
    return { x: this.x + 10, y: this.y + 292, w: 96, h: 22 };
  }

  chatRect() {
    return { x: this.x + 112, y: this.y + 292, w: 96, h: 22 };
  }

  leaveRect() {
    return { x: this.x + 214, y: this.y + 292, w: 96, h: 22 };
  }

  lootRect() {
    return { x: this.x + 10, y: this.y + 324, w: 150, h: 20 };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    if (this.hitRect(this.inviteRect(), mx, my)) {
      this.world.socket.out.partyInvite();
      return true;
    }
    if (this.inParty && this.hitRect(this.chatRect(), mx, my)) {
      this.world.game.ui?.openPartyChat?.();
      return true;
    }
    if (this.inParty && this.hitRect(this.leaveRect(), mx, my)) {
      this.world.socket.out.partyRemove(this.world.playerSerial);
      return true;
    }
    if (this.inParty && this.hitRect(this.lootRect(), mx, my)) {
      if (!this.isLeader) return true;
      this.party.canLoot = !this.party.canLoot;
      this.world.socket.out.partyLootType(this.party.canLoot);
      return true;
    }
    for (let i = 0; i < PARTY_SIZE; i++) {
      if (!this.memberAt(i)) continue;
      if (this.hitRect(this.tellRect(i), mx, my)) {
        this.tellMember(this.memberAt(i));
        return true;
      }
      if (this.isLeader && this.hitRect(this.kickRect(i), mx, my)) {
        this.world.socket.out.partyRemove(this.memberAt(i));
        return true;
      }
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  tellMember(serial) {
    this.world.game.ui?.showModalInput(`Tell ${this.memberName(serial)}`, '', 128, (value) => {
      const text = String(value || '').trim();
      if (text) this.world.socket.out.partyMessage(text, serial);
    }, true);
  }

  onMouseMove(mx, my) {
    if (!this.dragging) return;
    this.x = mx - this.dragOffset.x;
    this.y = my - this.dragOffset.y;
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = Math.round(pos.x);
    this.y = Math.round(pos.y);
    try {
      localStorage.setItem(partyStorageKey(this.world), JSON.stringify({ x: this.x, y: this.y }));
    } catch {
      /* ignore quota errors */
    }
  }

  close() {
    this.savePosition();
    this.world.game.ui?.closeParty?.();
  }

  drawButton(ctx, rect, label, active = false, disabled = false) {
    ctx.fillStyle = disabled ? 'rgba(0,0,0,0.18)' : active ? 'rgba(201,176,108,0.3)' : 'rgba(0,0,0,0.28)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = disabled ? '#4b422c' : active ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.fillStyle = disabled ? '#6d6147' : active ? '#f0dfa8' : '#d9c58d';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Party Manifest', this.x + 14, this.y + 10);
    this.drawButton(ctx, this.closeRect(), 'X');

    if (this.inParty) {
      const leaderName = this.memberName(this.party.leader);
      ctx.fillStyle = '#9e8e65';
      ctx.font = '10px monospace';
      ctx.fillText(`Leader: ${leaderName}`, this.x + 14, this.y + 28);
    } else {
      ctx.fillStyle = '#9e8e65';
      ctx.font = '11px monospace';
      ctx.fillText('You are not in a party.', this.x + 14, this.y + 56);
      ctx.fillStyle = '#7d6f4d';
      ctx.font = '10px monospace';
      ctx.fillText('Invite a player, or accept an invitation.', this.x + 14, this.y + 74);
    }

    for (let i = 0; i < PARTY_SIZE; i++) {
      const row = this.rowRect(i);
      const serial = this.memberAt(i);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(row.x, row.y, row.w, row.h);
      ctx.fillStyle = '#6d6147';
      ctx.font = '10px monospace';
      ctx.fillText(String(i + 1), row.x + 5, row.y + 6);
      if (!serial) continue;
      const leader = serial === this.party.leader;
      ctx.fillStyle = leader ? '#e8c96a' : '#d9c58d';
      ctx.font = '11px monospace';
      if (leader) ctx.fillText('*', row.x + 20, row.y + 5);
      let name = this.memberName(serial);
      const maxNameWidth = row.w - 82;
      while (name.length > 3 && ctx.measureText(name).width > maxNameWidth) name = name.slice(0, -2);
      ctx.fillText(name, row.x + 32, row.y + 5);
      const mobile = this.world.getMobile(serial);
      if (mobile?.hitsMax > 0) {
        const barX = row.x + 32;
        const barY = row.y + 16;
        const barW = Math.min(150, maxNameWidth);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(barX, barY, barW, 3);
        ctx.fillStyle = mobile.isDead ? '#6d6147' : '#9fd27a';
        ctx.fillRect(barX, barY, Math.max(0, Math.min(1, mobile.hits / mobile.hitsMax)) * barW, 3);
      }
      this.drawButton(ctx, this.tellRect(i), 'T');
      if (this.isLeader) this.drawButton(ctx, this.kickRect(i), 'K');
    }

    this.drawButton(ctx, this.inviteRect(), 'Invite');
    this.drawButton(ctx, this.chatRect(), 'Chat', false, !this.inParty);
    this.drawButton(ctx, this.leaveRect(), this.inParty && this.isLeader ? 'Disband' : 'Leave', false, !this.inParty);
    this.drawButton(ctx, this.lootRect(), `Loot: ${this.party.canLoot ? 'On' : 'Off'}`, this.party.canLoot, !this.inParty || !this.isLeader);

    ctx.fillStyle = '#7d6f4d';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('T tells · K kicks', this.x + this.width - 12, this.y + 332);
    ctx.textAlign = 'left';
  }
}

export class PartyInviteWindow {
  constructor(world, inviter) {
    this.world = world;
    this.inviter = inviter >>> 0;
    this.width = 310;
    this.height = 112;
    this.x = Math.round(Math.max(10, (window.innerWidth - this.width) / 2));
    this.y = 150;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  get name() {
    if (this.inviter === this.world.playerSerial) return this.world.player?.name || 'You';
    return this.world.getMobile(this.inviter)?.name || `0x${this.inviter.toString(16)}`;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  closeRect() {
    return { x: this.x + this.width - 28, y: this.y + 6, w: 20, h: 20 };
  }

  acceptRect() {
    return { x: this.x + this.width - 158, y: this.y + 74, w: 70, h: 24 };
  }

  declineRect() {
    return { x: this.x + this.width - 82, y: this.y + 74, w: 70, h: 24 };
  }

  accept() {
    this.world.socket.out.partyAccept(this.inviter);
    this.world.party.inviter = 0;
    this.world.game.ui?.closePartyInvite?.();
  }

  decline() {
    this.world.socket.out.partyDecline(this.inviter);
    this.world.party.inviter = 0;
    this.world.game.ui?.closePartyInvite?.();
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.decline();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.decline();
      return true;
    }
    if (this.hitRect(this.acceptRect(), mx, my)) {
      this.accept();
      return true;
    }
    if (this.hitRect(this.declineRect(), mx, my)) {
      this.decline();
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
  }

  onMouseUp() {
    this.dragging = false;
  }

  drawButton(ctx, rect, label, active = false) {
    ctx.fillStyle = active ? 'rgba(201,176,108,0.3)' : 'rgba(0,0,0,0.28)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = active ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.fillStyle = active ? '#f0dfa8' : '#d9c58d';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Party Invitation', this.x + 12, this.y + 10);
    this.drawButton(ctx, this.closeRect(), 'X');
    ctx.fillStyle = '#d9c58d';
    ctx.font = '11px monospace';
    let text = `${this.name} has invited you to a party.`;
    while (text.length > 8 && ctx.measureText(text).width > this.width - 24) text = text.slice(0, -2);
    ctx.fillText(text, this.x + 12, this.y + 42);
    this.drawButton(ctx, this.acceptRect(), 'Accept', true);
    this.drawButton(ctx, this.declineRect(), 'Decline');
  }
}

export class SpellbookWindow {
  constructor(world, item) {
    this.world = world;
    this.item = item;
    this.width = 420;
    this.height = 340;
    const saved = world.getGumpPosition(item.serial);
    this.x = saved ? saved.x : 160;
    this.y = saved ? saved.y : 90;
    this.page = 1;
    this.selected = 0;
    this.hover = null;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.press = null;
    this.dragSpell = null;
    this.lastCast = 0;
  }

  get info() {
    const byGraphic = getSpellbookInfo(this.item?.graphic || 0);
    if (byGraphic !== getSpellbookInfo(0) || !this.item?.spellbookType) return byGraphic;
    return getSpellbookInfoByOffset(this.item.spellbookType);
  }

  get pages() {
    return Math.max(1, Math.ceil(this.info.names.length / SPELLS_PER_PAGE));
  }

  get slots() {
    return this.item?.spells || null;
  }

  get pageSpells() {
    return getBookSpells(this.info, this.slots, this.page);
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  clampPage() {
    this.page = Math.max(1, Math.min(this.pages, this.page));
  }

  tabRect(index) {
    const count = this.pages;
    const gap = 4;
    const total = this.width - 28;
    const width = Math.min(44, (total - (count - 1) * gap) / count);
    return { x: this.x + 14 + index * (width + gap), y: this.y + 36, width, height: 20 };
  }

  tabAt(mx, my) {
    for (let i = 0; i < this.pages; i++) {
      const r = this.tabRect(i);
      if (mx >= r.x && mx < r.x + r.width && my >= r.y && my < r.y + r.height) return i + 1;
    }
    return null;
  }

  navAt(mx, my) {
    const y = this.y + this.height - 28;
    if (my >= y && my < y + 20) {
      if (mx >= this.x + 16 && mx < this.x + 80) return -1;
      if (mx >= this.x + this.width - 80 && mx < this.x + this.width - 16) return 1;
    }
    return 0;
  }

  spellRects() {
    const spells = this.pageSpells;
    const left = this.x + 16;
    const top = this.y + 66;
    const width = (this.width - 32) / 2;
    const height = (this.height - 66 - 34) / 4;
    return spells.map((spell, index) => ({
      spell,
      x: left + (index % 2) * width + 2,
      y: top + Math.floor(index / 2) * height + 2,
      width: width - 4,
      height: height - 4,
    }));
  }

  spellAt(mx, my) {
    for (const rect of this.spellRects()) {
      if (mx >= rect.x && mx < rect.x + rect.width && my >= rect.y && my < rect.y + rect.height) return rect;
    }
    return null;
  }

  tooltipAt(mx, my) {
    const rect = this.spellAt(mx, my);
    if (!rect) return null;
    const spell = rect.spell;
    const lines = [];
    if (spell.circle) lines.push(getCircleName(this.info, this.page));
    if (spell.mana != null) lines.push(`Mana: ${spell.mana}`);
    if (spell.powerWords) lines.push(spell.powerWords);
    lines.push('Double-click to cast');
    return { id: `spellbook:${this.item.serial}:${spell.slot}`, title: spell.name, lines };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (mx >= this.x + this.width - 30 && mx < this.x + this.width - 6 && my >= this.y + 6 && my < this.y + 28) {
      this.close();
      return true;
    }
    const tab = this.tabAt(mx, my);
    if (tab) {
      this.page = tab;
      this.selected = 0;
      return true;
    }
    const nav = this.navAt(mx, my);
    if (nav) {
      this.page += nav;
      this.clampPage();
      this.selected = 0;
      return true;
    }
    const rect = this.spellAt(mx, my);
    if (rect && button === 0) {
      this.selected = rect.spell.slot;
      this.press = { spell: rect.spell, x: mx, y: my };
      return true;
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
      this.clampPosition();
      return;
    }
    if (this.press) {
      const dx = mx - this.press.x;
      const dy = my - this.press.y;
      if (dx * dx + dy * dy >= 16) {
        this.dragSpell = this.press.spell;
        this.press = null;
      }
    }
    const rect = this.spellAt(mx, my);
    this.hover = rect ? rect.spell.slot : 0;
  }

  onMouseUp(mx, my) {
    this.dragging = false;
    this.press = null;
    if (this.dragSpell) {
      const hit = this.world.game.ui.hitTest(mx, my);
      const hotbar = hit?.obj?.slots ? hit.obj : null;
      const index = hotbar?.slotAt?.(mx, my) ?? -1;
      if (index >= 0) {
        const slot = hotbarSpellSlot(this.dragSpell);
        if (slot && hotbar.setSlot(index, slot)) {
          this.world.addMessage(`Bound ${slot.name} to hotbar slot ${index + 1}.`, 0x35, 1, 'System');
        }
      }
      this.dragSpell = null;
    }
    this.world.rememberGumpPosition(this.item.serial, this.x, this.y);
  }

  onDoubleClick(mx, my) {
    const rect = this.spellAt(mx, my);
    if (rect) this.cast(rect.spell);
  }

  onWheel(mx, my, delta) {
    if (!this.contains(mx, my)) return false;
    this.page += delta > 0 ? 1 : -1;
    this.clampPage();
    this.selected = 0;
    return true;
  }

  clampPosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  cast(spell) {
    if (!spell) return false;
    const now = performance.now();
    if (now - this.lastCast < 250) return false;
    const player = this.world.player;
    if (player && spell.mana != null && player.mana < spell.mana) {
      this.world.addMessage(`You do not have enough mana to cast ${spell.name}.`, 0x22, 1, 'System');
      return false;
    }
    this.lastCast = now;
    this.world.socket.out.castSpell(spell.id);
    return true;
  }

  close() {
    this.world.game.ui.closeSpellbook(this.item.serial);
  }

  drawIcon(ctx, rect, spell) {
    const ix = rect.x + 4;
    const iy = rect.y + 8;
    const size = 44;
    const img = this.world.assets.getGump(spell.icon);
    if (img) {
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, ix + (size - w) / 2, iy + (size - h) / 2, w, h);
      return;
    }
    const cx = ix + size / 2;
    const cy = iy + size / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#2c2619';
    ctx.fill();
    ctx.strokeStyle = '#8d7a52';
    ctx.stroke();
    ctx.fillStyle = '#d9c58d';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(spell.slot), cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  draw(ctx) {
    const info = this.info;
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${info.name} Spellbook`, this.x + 14, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.textAlign = 'right';
    ctx.fillText('X', this.x + this.width - 12, this.y + 10);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 14, this.y + 32, this.width - 28, 1);

    for (let i = 0; i < this.pages; i++) {
      const r = this.tabRect(i);
      const active = this.page === i + 1;
      ctx.fillStyle = active ? '#453a23' : '#221d12';
      ctx.fillRect(r.x, r.y, r.width, r.height);
      ctx.strokeStyle = active ? '#c9b06c' : '#5f5133';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);
      ctx.fillStyle = active ? '#f0dfae' : '#9e8e65';
      ctx.font = active ? 'bold 12px monospace' : '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), r.x + r.width / 2, r.y + 4);
    }

    const title = getCircleName(info, this.page);
    ctx.fillStyle = '#bfa96f';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, this.x + this.width / 2, this.y + 60);
    ctx.textAlign = 'left';

    if (this.slots == null) {
      ctx.fillStyle = '#7b6d4d';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for spellbook contents...', this.x + this.width / 2, this.y + this.height / 2 - 8);
      ctx.textAlign = 'left';
    } else if (!this.pageSpells.length) {
      ctx.fillStyle = '#7b6d4d';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No spells on this page.', this.x + this.width / 2, this.y + this.height / 2 - 8);
      ctx.textAlign = 'left';
    }

    for (const rect of this.spellRects()) {
      const spell = rect.spell;
      const active = this.selected === spell.slot;
      const hovered = this.hover === spell.slot;
      ctx.fillStyle = active ? 'rgba(201,176,108,0.16)' : hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = active ? '#c9b06c' : hovered ? '#8d7a52' : '#3f3522';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
      ctx.clip();
      this.drawIcon(ctx, rect, spell);

      const textX = rect.x + 54;
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(spell.name, textX, rect.y + 8);
      if (spell.powerWords) {
        ctx.fillStyle = '#9e8e65';
        ctx.font = '10px monospace';
        ctx.fillText(spell.powerWords, textX, rect.y + 26);
      }
      if (spell.mana != null) {
        ctx.fillStyle = '#7fb3dc';
        ctx.font = '10px monospace';
        ctx.fillText(`${spell.mana} mana`, textX, rect.y + 42);
      }
      ctx.restore();
    }

    ctx.fillStyle = '#8d8060';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Double-click a spell to cast', this.x + this.width / 2, this.y + this.height - 46);
    ctx.textAlign = 'left';

    const navY = this.y + this.height - 28;
    ctx.strokeStyle = this.page > 1 ? '#8d7a52' : '#3f3522';
    ctx.strokeRect(this.x + 16.5, navY + 0.5, 63, 19);
    ctx.strokeStyle = this.page < this.pages ? '#8d7a52' : '#3f3522';
    ctx.strokeRect(this.x + this.width - 79.5, navY + 0.5, 63, 19);
    ctx.fillStyle = this.page > 1 ? '#d9c58d' : '#5f5133';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('< Prev', this.x + 48, navY + 4);
    ctx.fillStyle = this.page < this.pages ? '#d9c58d' : '#5f5133';
    ctx.fillText('Next >', this.x + this.width - 48, navY + 4);
    ctx.fillStyle = '#bfa96f';
    ctx.fillText(`Page ${this.page} / ${this.pages}`, this.x + this.width / 2, navY + 4);
    ctx.textAlign = 'left';
  }
}

const PAPERDOLL_STORAGE_BASE = 'legionuo.paperdoll.v1';
const PAPERDOLL_WIDTH = 262;
const PAPERDOLL_HEIGHT = 324;
const PAPERDOLL_AVATAR = { x: 8, y: 19, w: 246, h: 237 };
const PAPERDOLL_MALE_GUMP_OFFSET = 50000;
const PAPERDOLL_FEMALE_GUMP_OFFSET = 60000;
const PAPERDOLL_BUTTON_X = 185;
const PAPERDOLL_BUTTON_Y = 44;
const PAPERDOLL_LEFT_LAYERS = [
  Layer.Helm,
  Layer.Earrings,
  Layer.Necklace,
  Layer.Ring,
  Layer.Bracelet,
  Layer.Tunic,
  Layer.OneHanded,
  Layer.TwoHanded,
  Layer.Talisman,
];
const PAPERDOLL_RIGHT_LAYERS = [
  Layer.Robe,
  Layer.Gloves,
  Layer.Torso,
  Layer.Shirt,
  Layer.Arms,
  Layer.Pants,
  Layer.Skirt,
  Layer.Cloak,
  Layer.Waist,
  Layer.Shoes,
];
function paperdollStorageKey(world) {
  return accountStorageKey(world, PAPERDOLL_STORAGE_BASE);
}

function loadPaperdollPositions(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(paperdollStorageKey(world)) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function savePaperdollPosition(world, serial, x, y) {
  try {
    const all = loadPaperdollPositions(world);
    all[String(serial)] = { x: Math.round(x), y: Math.round(y) };
    localStorage.setItem(paperdollStorageKey(world), JSON.stringify(all));
  } catch {}
}

// Paperdoll name/title text arrives as plain text, so drawServerText bails out
// and the caller is left to render it. Break it into lines that fit the plate
// instead of letting a long title run past the gump.
function wrapPlainText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        if (line) {
          lines.push(line);
          line = '';
        }
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      const test = line ? `${line} ${rest}` : rest;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = rest;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawWrappedText(ctx, text, options) {
  const { x, y, width, height, align = 'center', color = '#fff', fontSize = 12, bold = false } = options;
  const lineHeight = fontSize + 3;
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  if (!text || width <= 0 || height <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${options.fontFamily || 'monospace'}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;

  const lines = wrapPlainText(ctx, text, width);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible[visible.length - 1] = fitText(ctx, `${visible[visible.length - 1]}...`, width);
  }
  const textX = align === 'center' ? x + width / 2 : align === 'right' ? x + width : x;
  visible.forEach((line, index) => ctx.fillText(line, textX, y + index * lineHeight));
  ctx.restore();
}

export class PaperdollWindow {
  constructor(world, mobile) {
    this.world = world;
    this.mobile = mobile;
    const saved = loadPaperdollPositions(world)[String(this.mobile.serial)];
    const fallback = { x: 140, y: 100 };
    const pos = clampPosition(
      saved?.x ?? fallback.x,
      saved?.y ?? fallback.y,
      PAPERDOLL_WIDTH,
      PAPERDOLL_HEIGHT
    );
    this.x = pos.x;
    this.y = pos.y;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.press = null;
    this.heldOrigin = null;
    this.start = performance.now();
  }

  get isOwn() {
    return this.mobile === this.world.player;
  }

  get background() {
    return this.world.assets.getGump(this.isOwn ? 0x07d0 : 0x07d1);
  }

  get width() {
    return this.background?.width || PAPERDOLL_WIDTH;
  }

  get height() {
    return this.background?.height || PAPERDOLL_HEIGHT;
  }

  get avatarRect() {
    return {
      x: this.x + PAPERDOLL_AVATAR.x,
      y: this.y + PAPERDOLL_AVATAR.y,
      w: PAPERDOLL_AVATAR.w,
      h: PAPERDOLL_AVATAR.h,
    };
  }

  get equipmentSlots() {
    const slots = [];
    PAPERDOLL_LEFT_LAYERS.forEach((layer, index) => {
      slots.push({ layer, x: 2, y: 67 + index * 21, w: 19, h: 20, item: this.mobile.getItem(layer) });
    });
    PAPERDOLL_RIGHT_LAYERS.forEach((layer, index) => {
      // Half a slot higher than the left column so the last row clears the
      // name/title plate at the bottom of the gump.
      slots.push({ layer, x: 166, y: 57 + index * 21, w: 19, h: 20, item: this.mobile.getItem(layer) });
    });
    return slots;
  }

  get buttons() {
    const player = this.world.player;
    const defs = this.isOwn
      ? [
          { id: 'help', label: 'Help', gump: 0x07ef, x: PAPERDOLL_BUTTON_X, y: PAPERDOLL_BUTTON_Y + 27 * 0 },
          { id: 'logout', label: 'Logout', gump: 2009, x: PAPERDOLL_BUTTON_X, y: PAPERDOLL_BUTTON_Y + 27 * 2 },
          { id: 'journal', label: 'Journal', gump: 2012, x: PAPERDOLL_BUTTON_X, y: PAPERDOLL_BUTTON_Y + 27 * 3 },
          { id: 'skills', label: 'Skills', gump: 2015, x: PAPERDOLL_BUTTON_X, y: PAPERDOLL_BUTTON_Y + 27 * 4 },
          {
            id: 'war',
            label: player?.inWarMode ? 'War Mode' : 'Peace Mode',
            gump: player?.inWarMode ? 0x07e8 : 0x07e5,
            x: PAPERDOLL_BUTTON_X,
            y: PAPERDOLL_BUTTON_Y + 27 * 6,
          },
          { id: 'status', label: 'Status', gump: 2027, x: PAPERDOLL_BUTTON_X, y: PAPERDOLL_BUTTON_Y + 27 * 7 },
          { id: 'profile', label: 'Profile', gump: 0x07d2, x: 25, y: 196, w: 19, h: 51 },
          { id: 'party', label: 'Party', gump: 0x07d2, x: 40, y: 196, w: 19, h: 51 },
          { id: 'virtue', label: 'Virtues', gump: 0x07d2, x: 55, y: 196, w: 19, h: 51 },
          { id: 'book', label: 'Equipment', gump: 0x07d2, x: 70, y: 196, w: 19, h: 51 },
        ]
      : [
          { id: 'status', label: 'Status', gump: 2027, x: PAPERDOLL_BUTTON_X, y: PAPERDOLL_BUTTON_Y + 27 * 7 },
          { id: 'profile', label: 'Profile', gump: 0x07d2, x: 25, y: 196, w: 19, h: 51 },
          { id: 'book', label: 'Equipment', gump: 0x07d2, x: 40, y: 196, w: 19, h: 51 },
        ];
    return defs.map((button) => {
      const img = this.world.assets.getGump(button.gump);
      return {
        ...button,
        w: button.w ?? img?.width ?? 64,
        h: button.h ?? img?.height ?? 22,
      };
    });
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  slotAt(mx, my) {
    for (const slot of this.equipmentSlots) {
      const sx = this.x + slot.x;
      const sy = this.y + slot.y;
      if (mx >= sx && mx < sx + slot.w && my >= sy && my < sy + slot.h) return slot;
    }
    return null;
  }

  equipmentAt(mx, my) {
    return this.slotAt(mx, my)?.item || null;
  }

  targetAt(mx, my) {
    if (!this.contains(mx, my)) return null;
    return this.equipmentAt(mx, my);
  }

  buttonAt(mx, my) {
    for (const button of this.buttons) {
      const bx = this.x + button.x;
      const by = this.y + button.y;
      if (mx >= bx && mx < bx + button.w && my >= by && my < by + button.h) return button;
    }
    return null;
  }

  layerForItem(item) {
    const dataLayer = this.world.assets.staticLayer(item.graphic) || 0;
    if (dataLayer > 0 && dataLayer !== Layer.Backpack) return dataLayer;
    if (item.layer > 0 && item.layer !== Layer.Backpack) return item.layer;
    return 0;
  }

  tooltipAt(mx, my) {
    const button = this.buttonAt(mx, my);
    if (button) {
      return { id: `paperdoll:${this.mobile.serial}:button:${button.id}`, title: button.label };
    }
    const slot = this.slotAt(mx, my);
    if (!slot) return null;
    if (!slot.item) {
      return { id: `paperdoll:${this.mobile.serial}:layer:${slot.layer}`, title: layerName(slot.layer) };
    }
    return {
      id: `paperdoll:${this.mobile.serial}:${slot.item.serial}`,
      serial: slot.item.serial,
      title: resolveItemName(this.world, slot.item),
    };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      const item = this.equipmentAt(mx, my);
      if (item) this.world.game.ui.openContextMenu(item.serial, mx, my);
      else this.close();
      return true;
    }
    if (button === 0) {
      const buttonHit = this.buttonAt(mx, my);
      if (buttonHit) {
        this.activateButton(buttonHit.id);
        return true;
      }
      const slot = this.slotAt(mx, my);
      if (slot) {
        if (slot.item && !this.world.held && this.canLiftSlot(slot)) {
          this.press = { item: slot.item, x: mx, y: my, moved: false };
        }
        return true;
      }
      if (this.world.held) return true;
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (this.press && !this.press.moved) {
      const dx = mx - this.press.x;
      const dy = my - this.press.y;
      if (dx * dx + dy * dy >= 16) {
        this.press.moved = true;
        if (!this.world.held) {
          const item = this.press.item;
          this.heldOrigin = { container: item.container, layer: item.layer, x: item.x, y: item.y };
          this.world.held = item;
          this.world.socket.out.pickup(item.serial, 1);
        }
      }
    }
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp(mx, my) {
    if (this.dragging) this.savePosition();
    this.dragging = false;
    if (this.press && !this.press.moved) this.world.socket.out.singleClick(this.press.item.serial);
    this.press = null;
    if (this.world.held && this.contains(mx, my)) this.equipHeld(mx, my);
  }

  onItemDrop(mx, my) {
    if (!this.world.held || !this.contains(mx, my)) return false;
    this.equipHeld(mx, my);
    return true;
  }

  equipHeld(mx, my) {
    const item = this.world.held;
    if (!item) return false;
    if (!this.isOwn) {
      this.restoreHeld(item);
      return true;
    }
    const slot = this.slotAt(mx, my);
    const layer = this.layerForItem(item) || slot?.layer || 0;
    if (!layer) {
      this.restoreHeld(item);
      return true;
    }
    this.world.socket.out.equip(item.serial, layer, this.mobile.serial);
    this.world.held = null;
    this.heldOrigin = null;
    return true;
  }

  canLiftSlot() {
    if (this.isOwn) return true;
    const player = this.world.player;
    if (!player || !this.mobile) return false;
    const distance = Math.max(Math.abs(player.x - this.mobile.x), Math.abs(player.y - this.mobile.y));
    return distance <= 3;
  }

  durability(item) {
    if (!item) return null;
    const opl = this.world.opl.resolve(item.serial);
    if (!opl?.lines?.length) {
      this.world.opl.request(item.serial);
      return null;
    }
    for (const line of opl.lines) {
      const match = /(durability|hit points|uses remaining)[^0-9]*?(\d+)\s*(?:\/\s*(\d+))?\s*%?/i.exec(line);
      if (match) {
        const value = Math.max(0, Number(match[2]) || 0);
        const max = Math.max(1, Number(match[3]) || 100);
        const ratio = Math.max(0, Math.min(1, value / max));
        return { value, max, ratio, text: line };
      }
    }
    return null;
  }

  restoreHeld(item) {
    const origin = this.heldOrigin;
    const container = origin?.container ?? item.container;
    const layer = origin?.layer ?? item.layer;
    const x = origin?.x ?? item.x;
    const y = origin?.y ?? item.y;
    this.world.held = null;
    this.heldOrigin = null;
    if (layer && container === this.mobile.serial) {
      this.world.socket.out.equip(item.serial, layer, this.mobile.serial);
    } else if (container) {
      this.world.socket.out.drop(item.serial, x, y, 0, layer || 0, container);
    } else {
      this.world.socket.out.drop(item.serial, x, y, 0, 0, 0);
    }
  }

  activateButton(id) {
    const ui = this.world.game.ui;
    if (id === 'help') {
      ui.command('-help');
    } else if (id === 'journal') {
      ui.journal.toggle();
    } else if (id === 'skills') {
      ui.toggleSkills();
    } else if (id === 'war') {
      ui.toggleWarMode();
    } else if (id === 'status') {
      ui.showStatus();
    } else if (id === 'logout') {
      ui.logout();
    } else if (id === 'profile') {
      this.world.socket.out.profileRequest(this.mobile.serial);
    } else if (id === 'party') {
      ui.toggleParty();
    } else if (id === 'virtue') {
      const existing = ui.getWindow('virtue', 'player');
      if (existing) ui.raiseWindow(existing);
      else ui.addWindow('virtue', 'player', new VirtueWindow(this.world));
    } else if (id === 'book') {
      const key = `equipment:${this.mobile.serial}`;
      const existing = ui.getWindow('equipment', key);
      if (existing) ui.raiseWindow(existing);
      else ui.addWindow('equipment', key, new EquipmentWindow(this.world, this.mobile));
    }
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    savePaperdollPosition(this.world, this.mobile.serial, this.x, this.y);
  }

  close() {
    this.savePosition();
    this.world.game.ui.closePaperdoll(this.mobile.serial);
  }

  bodyGump() {
    const graphic = this.mobile.graphic;
    const hue = this.mobile.hue || 0;
    // TazUO's paperdoll body is always partial-hued: skin and cloth are grey
    // in the body gump, while the outline and details stay their own colour.
    if (graphic === 0x0191 || graphic === 0x0193) return { id: 0x0d, hue, partial: true };
    if (graphic === 0x025d) return { id: 0x0e, hue, partial: true };
    if (graphic === 0x025e) return { id: 0x0f, hue, partial: true };
    if (graphic === 0x029a || graphic === 0x02b6) return { id: 0x029a, hue, partial: true };
    if (graphic === 0x029b || graphic === 0x02b7) return { id: 0x0299, hue, partial: true };
    if (graphic === 0x04e5) return { id: 0xc835, hue, partial: true };
    if (graphic === 0x03db) return { id: 0x0c, hue: 0x03ea, partial: true };
    return { id: isFemaleMobile(this.mobile) ? 0x0d : 0x0c, hue, partial: true };
  }

  equipGump(item) {
    const assets = this.world.assets;
    if (!assets.tileData) return null;
    let animId = assets.staticAnimId(item.graphic) || 0;
    if (!animId) return null;
    if ((this.mobile.graphic === 0x02b6 || this.mobile.graphic === 0x02b7) && animId === 0x03ca) {
      animId = 0x0223;
    }
    const female = isFemaleMobile(this.mobile);
    const conv = assets.equipConv(baseBodyGraphic(this.mobile), animId);
    if (conv) {
      if (conv.gump > PAPERDOLL_MALE_GUMP_OFFSET) {
        animId =
          conv.gump >= PAPERDOLL_FEMALE_GUMP_OFFSET
            ? conv.gump - PAPERDOLL_FEMALE_GUMP_OFFSET
            : conv.gump - PAPERDOLL_MALE_GUMP_OFFSET;
      } else {
        animId = conv.gump;
      }
      if (!animId) return null;
    }
    const hue = (item.hue || 0) & 0x3fff;
    // The paperdoll gump is a different graphic number to the item, so the
    // partial flag has to come from the item's own tiledata row.
    const partial = assets.staticIsPartialHue(item.graphic) || ((item.hue || 0) & 0x8000) !== 0;

    // Some shards (UOAlive, Enhanced Client art) map an item graphic and body
    // to a newer appearance id in tileart.uop. TazUO checks this before the
    // normal anim id + gender gump offset.
    const appearance = assets.tileArtAppearance(item.graphic, baseBodyGraphic(this.mobile));
    if (appearance) {
      const tileArtGump = PAPERDOLL_MALE_GUMP_OFFSET + appearance;
      if (assets.gumpProbe(tileArtGump, hue, partial) !== false) {
        return { id: tileArtGump, hue, partial };
      }
    }

    const offset = female ? PAPERDOLL_FEMALE_GUMP_OFFSET : PAPERDOLL_MALE_GUMP_OFFSET;
    const alternateOffset = female ? PAPERDOLL_MALE_GUMP_OFFSET : PAPERDOLL_FEMALE_GUMP_OFFSET;
    const primary = animId + offset;
    if (assets.gumpProbe(primary, hue, partial) === false) {
      const alternate = animId + alternateOffset;
      if (assets.gumpProbe(alternate, hue, partial)) return { id: alternate, hue, partial };
    }
    return { id: primary, hue, partial };
  }

  backpackGump() {
    if (!this.world.assets.tileData) return 0;
    const item =
      this.mobile.getItem(Layer.Backpack) ||
      [...this.mobile.items.values()].find((entry) => entry.layer === Layer.Backpack);
    if (!item) return 0;
    const animId = this.world.assets.staticAnimId(item.graphic);
    return animId ? animId + PAPERDOLL_MALE_GUMP_OFFSET : 0;
  }

  draw(ctx, now) {
    const m = this.mobile;
    const bg = this.background;
    if (bg) ctx.drawImage(bg, this.x, this.y);
    else {
      ctx.fillStyle = 'rgba(24,20,14,0.96)';
      ctx.fillRect(this.x, this.y, this.width, this.height);
      ctx.strokeStyle = '#8d7a52';
      ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    }

    const avatar = this.avatarRect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x, this.y, this.width, this.height);
    ctx.clip();
    const body = this.bodyGump();
    const bodyImg = this.world.assets.getGump(body.id, body.hue, body.partial);
    if (bodyImg) ctx.drawImage(bodyImg, avatar.x, avatar.y);
    const layerOrder = buildEquipmentOrder(m, this.world.assets, {
      altTorso: isFemaleMobile(m) || isGargoyleBody(m.graphic),
    });
    for (const layer of layerOrder) {
      const item = m.getItem(layer);
      if (!item) continue;
      this.world.assets.getTileArt(item.graphic);
      const gump = this.equipGump(item);
      if (!gump) continue;
      const img = this.world.assets.getGump(gump.id, gump.hue, gump.partial);
      if (img) ctx.drawImage(img, avatar.x, avatar.y);
    }
    const backpack = this.backpackGump();
    if (backpack) {
      const img = this.world.assets.getGump(backpack);
      if (img) ctx.drawImage(img, this.x, avatar.y);
    }
    ctx.restore();

    for (const slot of this.equipmentSlots) {
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(slotX, slotY, slot.w, slot.h);
      ctx.strokeStyle = 'rgba(154,126,71,0.55)';
      ctx.strokeRect(slotX + 0.5, slotY + 0.5, slot.w - 1, slot.h - 1);
      if (!slot.item) continue;
      const img = this.world.assets.getStatic(slot.item.graphic, slot.item.hue || 0);
      if (img) {
        const fit = Math.min(1, (slot.w - 2) / Math.max(1, img.width), (slot.h - 2) / Math.max(1, img.height));
        const w = img.width * fit;
        const h = img.height * fit;
        ctx.drawImage(img, slotX + (slot.w - w) / 2, slotY + (slot.h - h) / 2, w, h);
      }
      const wear = this.durability(slot.item);
      if (wear) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(slotX + 1, slotY + slot.h - 3, slot.w - 2, 2);
        ctx.fillStyle = wear.ratio <= 0.2 ? '#d06a4a' : wear.ratio <= 0.5 ? '#d6b45d' : '#7fb36a';
        ctx.fillRect(slotX + 1, slotY + slot.h - 3, (slot.w - 2) * wear.ratio, 2);
      }
    }

    for (const button of this.buttons) {
      const img = this.world.assets.getGump(button.gump);
      const bx = this.x + button.x;
      const by = this.y + button.y;
      if (img) {
        ctx.drawImage(img, bx, by);
      } else {
        ctx.fillStyle = 'rgba(80,64,34,0.85)';
        ctx.fillRect(bx, by, button.w, button.h);
        ctx.strokeStyle = '#9a7e47';
        ctx.strokeRect(bx + 0.5, by + 0.5, button.w - 1, button.h - 1);
      }
    }

    const charName = m.name || 'Unknown';
    const charTitle = m.title || '';
    if (
      !drawServerText(ctx, charName, {
        x: this.x + 39,
        y: this.y + 253,
        width: 185,
        height: 16,
        align: 'center',
        defaultColor: '#e8d7a8',
        fontSize: 13,
        bold: true,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(charName, this.x + 39 + 185 / 2, this.y + 261);
    }
    if (
      !drawServerText(ctx, charTitle, {
        x: this.x + 39,
        y: this.y + 270,
        width: 185,
        height: 32,
        align: 'center',
        defaultColor: '#bfa96f',
        fontSize: 12,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      drawWrappedText(ctx, charTitle, {
        x: this.x + 39,
        y: this.y + 270,
        width: 185,
        height: 32,
        align: 'center',
        color: '#bfa96f',
        fontSize: 12,
        fontFamily: 'monospace',
      });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

const HOUSE_CATEGORIES = ['Wall', 'Door', 'Floor', 'Stair', 'Roof', 'Misc'];

export class HouseWindow {
  constructor(world, serial) {
    this.world = world;
    this.serial = serial >>> 0;
    this.width = 372;
    this.height = 342;
    this.x = Math.max(20, Math.round((window.innerWidth - this.width) / 2));
    this.y = Math.max(20, Math.round((window.innerHeight - this.height) / 2));
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.category = 'Wall';
    this.erase = false;
    this.floor = 1;
    this.hover = null;
  }

  get info() {
    const design = this.world.customHouses?.get(this.serial);
    if (design) return design;
    return this.world.customHouse && this.world.customHouse.serial === this.serial ? this.world.customHouse : null;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 7, w: 18, h: 18 };
  }

  buttons() {
    const out = HOUSE_CATEGORIES.map((name, index) => ({
      id: `cat:${name}`,
      label: name,
      x: this.x + 14 + (index % 3) * 116,
      y: this.y + 42 + Math.floor(index / 3) * 26,
      w: 110,
      h: 22,
    }));
    out.push(
      { id: 'erase', label: this.erase ? 'Erase: on' : 'Erase: off', x: this.x + 14, y: this.y + 102, w: 110, h: 22 },
      { id: 'add', label: 'Add selected...', x: this.x + 130, y: this.y + 102, w: 110, h: 22 },
      { id: 'delete', label: 'Delete selected...', x: this.x + 246, y: this.y + 102, w: 112, h: 22 },
      { id: 'floorDown', label: '< Floor', x: this.x + 14, y: this.y + 130, w: 82, h: 22 },
      { id: 'floorUp', label: 'Floor >', x: this.x + 102, y: this.y + 130, w: 82, h: 22 },
      { id: 'backup', label: 'Backup', x: this.x + 190, y: this.y + 130, w: 80, h: 22 },
      { id: 'restore', label: 'Restore', x: this.x + 276, y: this.y + 130, w: 82, h: 22 },
      { id: 'commit', label: 'Commit', x: this.x + 14, y: this.y + 166, w: 82, h: 22 },
      { id: 'revert', label: 'Revert', x: this.x + 102, y: this.y + 166, w: 82, h: 22 },
      { id: 'clear', label: 'Clear', x: this.x + 190, y: this.y + 166, w: 80, h: 22 },
      { id: 'exit', label: 'Exit editing', x: this.x + 276, y: this.y + 166, w: 82, h: 22 }
    );
    return out;
  }

  hit(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  buttonAt(mx, my) {
    return this.buttons().find((rect) => this.hit(rect, mx, my)) || null;
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || this.hit(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const btn = this.buttonAt(mx, my);
    if (btn) {
      this.activate(btn.id);
      return true;
    }
    this.dragging = true;
    this.dragOffset = { x: mx - this.x, y: my - this.y };
    return true;
  }

  onMouseMove(mx, my) {
    this.hover = this.buttonAt(mx, my)?.id || null;
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  promptCoordinates(title, onAccept) {
    this.world.game.ui.showModalInput(title, '0x0 0 0 0', 64, (value) => {
      const parts = value.trim().split(/[\s,]+/);
      const graphic = Number.parseInt(parts[0], 0);
      const x = Number.parseInt(parts[1], 0);
      const y = Number.parseInt(parts[2], 0);
      const z = Number.parseInt(parts[3], 0);
      if (!Number.isFinite(graphic) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      onAccept(graphic, x, y, Number.isFinite(z) ? z : 0);
    });
  }

  activate(id) {
    const out = this.world.socket.out;
    if (id.startsWith('cat:')) {
      this.category = id.slice(4);
      return;
    }
    if (id === 'floorDown') {
      this.floor = Math.max(1, this.floor - 1);
      out.houseGoToFloor(this.floor);
    } else if (id === 'floorUp') {
      this.floor = Math.min(4, this.floor + 1);
      out.houseGoToFloor(this.floor);
    } else if (id === 'erase') {
      this.erase = !this.erase;
    } else if (id === 'add') {
      this.promptCoordinates(`Add ${this.category} (graphic x y z)`, (graphic, x, y, z) => {
        if (this.category === 'Stair') out.houseAddStair(graphic, x, y);
        else if (this.category === 'Roof') out.houseAddRoof(graphic, x, y, z);
        else out.houseAddItem(graphic, x, y);
      });
    } else if (id === 'delete') {
      this.promptCoordinates(`Delete ${this.category} (graphic x y z)`, (graphic, x, y, z) => {
        if (this.category === 'Roof') out.houseDeleteRoof(graphic, x, y, z);
        else out.houseDeleteItem(graphic, x, y, z);
      });
    } else if (id === 'backup') out.houseBackup();
    else if (id === 'restore') out.houseRestore();
    else if (id === 'commit') out.houseCommit();
    else if (id === 'revert') out.houseRevert();
    else if (id === 'clear') out.houseClear();
    else if (id === 'exit') {
      out.houseExit();
      this.close();
    }
  }

  close() {
    this.world.game.ui.removeWindow('house', this.serial);
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Custom House Design', this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.textAlign = 'right';
    ctx.fillText('X', this.x + this.width - 12, this.y + 10);
    ctx.textAlign = 'left';
    const info = this.info;
    ctx.fillStyle = '#8d8060';
    ctx.font = '10px monospace';
    ctx.fillText(
      info ? `Serial 0x${this.serial.toString(16)}  revision ${info.revision}  planes ${info.planes}` : `Serial 0x${this.serial.toString(16)}`,
      this.x + 14,
      this.y + 28
    );
    for (const rect of this.buttons()) {
      const active = rect.id === `cat:${this.category}` || (rect.id === 'erase' && this.erase);
      const hovered = this.hover === rect.id;
      ctx.fillStyle = active ? 'rgba(201,176,108,0.3)' : hovered ? 'rgba(201,176,108,0.16)' : 'rgba(0,0,0,0.24)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = active ? '#c9b06c' : '#5f5133';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = active ? '#f0dfa8' : '#d9c58d';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rect.label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    }
    ctx.fillStyle = '#8d8060';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Editing category ${this.category}; floor ${this.floor}. Coordinates are in house-local tiles.`, this.x + 14, this.y + 202);
    ctx.fillText('Use Add/Delete with a graphic id and x y z, or place/erase through the shard commands.', this.x + 14, this.y + 216);
    ctx.textBaseline = 'top';
  }
}

const FRIEND_STORAGE_BASE = 'legionuo.friends.v1';

function friendStorageKey(world) {
  return accountStorageKey(world, FRIEND_STORAGE_BASE);
}

export function loadFriends(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(friendStorageKey(world)) || 'null');
    return Array.isArray(saved) ? saved.filter((name) => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFriends(world, friends) {
  try {
    localStorage.setItem(friendStorageKey(world), JSON.stringify([...new Set(friends)]));
  } catch {
    /* ignore quota errors */
  }
}

export class FriendListWindow {
  constructor(world) {
    this.world = world;
    this.width = 230;
    this.height = 280;
    this.x = Math.max(20, Math.round((window.innerWidth - this.width) / 2));
    this.y = Math.max(20, Math.round((window.innerHeight - this.height) / 2));
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.friends = loadFriends(world);
    this.hover = -1;
  }

  online(name) {
    const key = String(name || '').toLowerCase();
    return [...this.world.entities.values()].some((entity) => entity.isMobile && entity.name && entity.name.toLowerCase() === key);
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 7, w: 18, h: 18 };
  }

  addRect() {
    return { x: this.x + 12, y: this.y + this.height - 30, w: this.width - 24, h: 20 };
  }

  rowRect(index) {
    return { x: this.x + 10, y: this.y + 40 + index * 22, w: this.width - 20, h: 20 };
  }

  hit(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  addFriend() {
    this.world.game.ui.showModalInput('Friend name', '', 30, (value) => {
      const name = value.trim();
      if (!name) return;
      if (!this.friends.some((friend) => friend.toLowerCase() === name.toLowerCase())) this.friends.push(name);
      saveFriends(this.world, this.friends);
    });
  }

  removeFriend(index) {
    if (index < 0 || index >= this.friends.length) return;
    this.friends.splice(index, 1);
    saveFriends(this.world, this.friends);
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || this.hit(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    if (this.hit(this.addRect(), mx, my)) {
      this.addFriend();
      return true;
    }
    const index = Math.floor((my - this.y - 40) / 22);
    if (index >= 0 && index < this.friends.length && this.hit(this.rowRect(index), mx, my)) {
      if (button === 2) this.removeFriend(index);
      else {
        const name = this.friends[index];
        this.world.game.ui.addJournal(`${name}: ${this.online(name) ? 'online' : 'offline'}`, '#b8a06a', true);
      }
      return true;
    }
    this.dragging = true;
    this.dragOffset = { x: mx - this.x, y: my - this.y };
    return true;
  }

  onMouseMove(mx, my) {
    const index = Math.floor((my - this.y - 40) / 22);
    this.hover = index >= 0 && index < this.friends.length ? index : -1;
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  close() {
    this.world.game.ui.removeWindow('friends', 'player');
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Friends', this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.textAlign = 'right';
    ctx.fillText('X', this.x + this.width - 12, this.y + 10);
    ctx.textAlign = 'left';
    if (!this.friends.length) {
      ctx.fillStyle = '#8d8060';
      ctx.font = '11px monospace';
      ctx.fillText('No friends added.', this.x + 12, this.y + 46);
    }
    this.friends.forEach((name, index) => {
      const rect = this.rowRect(index);
      const online = this.online(name);
      ctx.fillStyle = this.hover === index ? 'rgba(201,176,108,0.18)' : 'rgba(0,0,0,0.2)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = online ? '#7ee08a' : '#8d8060';
      ctx.font = '11px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, rect.x + 8, rect.y + rect.h / 2);
      ctx.textAlign = 'right';
      ctx.fillText(online ? 'online' : 'offline', rect.x + rect.w - 8, rect.y + rect.h / 2);
      ctx.textAlign = 'left';
    });
    const add = this.addRect();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(add.x, add.y, add.w, add.h);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(add.x + 0.5, add.y + 0.5, add.w - 1, add.h - 1);
    ctx.fillStyle = '#d9c58d';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Add friend', add.x + add.w / 2, add.y + add.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

const VIRTUES = [
  ['Honesty', 1, 'Truthfulness and integrity.'],
  ['Compassion', 2, 'Mercy and empathy for others.'],
  ['Valor', 3, 'Courage in the face of danger.'],
  ['Justice', 4, 'Fairness and truth in judgment.'],
  ['Sacrifice', 5, 'Giving of oneself for others.'],
  ['Honor', 6, 'Respect and dignity in conduct.'],
  ['Spirituality', 7, 'Faith and connection to the divine.'],
  ['Humility', 8, 'Modesty and selflessness.'],
];

export class VirtueWindow {
  constructor(world) {
    this.world = world;
    this.width = 250;
    this.height = 300;
    this.x = Math.max(20, Math.round((window.innerWidth - this.width) / 2));
    this.y = Math.max(20, Math.round((window.innerHeight - this.height) / 2));
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.hover = null;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 7, w: 18, h: 18 };
  }

  rowRects() {
    return VIRTUES.map(([name], index) => ({ name, x: this.x + 12, y: this.y + 42 + index * 28, w: this.width - 24, h: 24 }));
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || this.hit(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const row = this.rowRects().find((rect) => this.hit(rect, mx, my));
    if (row) {
      this.world.socket.out.invokeVirtue(VIRTUES.find(([name]) => name === row.name)[1]);
      return true;
    }
    this.dragging = true;
    this.dragOffset = { x: mx - this.x, y: my - this.y };
    return true;
  }

  onMouseMove(mx, my) {
    this.hover = this.rowRects().find((rect) => this.hit(rect, mx, my))?.name || null;
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  hit(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  close() {
    this.world.game.ui.removeWindow('virtue', 'player');
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Virtues', this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.textAlign = 'right';
    ctx.fillText('X', this.x + this.width - 12, this.y + 10);
    ctx.textAlign = 'left';
    for (const rect of this.rowRects()) {
      const hovered = this.hover === rect.name;
      ctx.fillStyle = hovered ? 'rgba(201,176,108,0.22)' : 'rgba(0,0,0,0.22)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = hovered ? '#c9b06c' : '#4f432a';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = hovered ? '#f0dfa8' : '#d9c58d';
      ctx.font = '12px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(rect.name, rect.x + 8, rect.y + rect.h / 2);
      const info = VIRTUES.find(([name]) => name === rect.name);
      ctx.fillStyle = '#8d8060';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(info[2], rect.x + rect.w - 8, rect.y + rect.h / 2);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'top';
  }
}

export class EquipmentWindow {
  constructor(world, mobile) {
    this.world = world;
    this.mobile = mobile;
    this.width = 320;
    this.height = 360;
    this.x = Math.max(20, Math.round((window.innerWidth - this.width) / 2));
    this.y = Math.max(20, Math.round((window.innerHeight - this.height) / 2));
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.scroll = 0;
  }

  get items() {
    return [...(this.mobile?.equipment?.values() || [])].filter(Boolean);
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 7, w: 18, h: 18 };
  }

  hit(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || this.hit(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const index = Math.floor((my - this.y - 40 + this.scroll) / 30);
    const item = this.items[index];
    if (item && mx >= this.x + 12 && mx < this.x + this.width - 12) {
      if (button === 0) this.world.socket.out.doubleClick(item.serial);
      else if (button === 2) this.world.game.ui.openContextMenu(item.serial, mx, my);
      return true;
    }
    this.dragging = true;
    this.dragOffset = { x: mx - this.x, y: my - this.y };
    return true;
  }

  onMouseMove(mx, my) {
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  onWheel(mx, my, delta) {
    if (!this.contains(mx, my)) return false;
    this.scroll = Math.max(0, Math.min(Math.max(0, this.items.length * 30 - (this.height - 50)), this.scroll + (delta > 0 ? 30 : -30)));
    return true;
  }

  close() {
    this.world.game.ui.removeWindow('equipment', `equipment:${this.mobile.serial}`);
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${this.mobile?.name || 'Mobile'} equipment`, this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.textAlign = 'right';
    ctx.fillText('X', this.x + this.width - 12, this.y + 10);
    ctx.textAlign = 'left';
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 4, this.y + 36, this.width - 8, this.height - 46);
    ctx.clip();
    this.items.forEach((item, index) => {
      const y = this.y + 40 + index * 30 - this.scroll;
      if (y > this.y + this.height || y + 30 < this.y + 36) return;
      ctx.fillStyle = index % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.16)';
      ctx.fillRect(this.x + 8, y, this.width - 16, 28);
      const img = this.world.assets.getStatic(item.graphic, item.hue || 0);
      if (img) {
        const scale = Math.min(1, 24 / Math.max(1, img.width), 24 / Math.max(1, img.height));
        ctx.drawImage(img, this.x + 12, y + 2, img.width * scale, img.height * scale);
      }
      ctx.fillStyle = '#d9c58d';
      ctx.font = '11px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(resolveItemName(this.world, item), this.x + 42, y + 14);
      const wear = this.world.opl.resolve(item.serial)?.lines?.find((line) => /durability|hit points|uses remaining/i.test(line));
      if (wear) {
        ctx.fillStyle = '#8d8060';
        ctx.font = '9px monospace';
        ctx.fillText(wear, this.x + this.width - 14 - ctx.measureText(wear).width, y + 14);
      }
    });
    ctx.restore();
    ctx.textBaseline = 'top';
  }
}

const STATUS_STORAGE_BASE = 'legionuo.status.v1';

function statusStorageKey(world) {
  return accountStorageKey(world, STATUS_STORAGE_BASE);
}

function loadStatusPosition(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(statusStorageKey(world)) || 'null');
    if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
    return { x: Number(saved.x), y: Number(saved.y) };
  } catch {
    return null;
  }
}

const STATUS_BUFF_SIZE = 24;
const STATUS_BUFF_MAX = 9;

function cycleStatLock(world, stat) {
  if (!world.statLocks) world.statLocks = { str: 0, dex: 0, int: 0 };
  const next = ((world.statLocks[stat] || 0) + 1) % 3;
  world.statLocks[stat] = next;
  const index = stat === 'str' ? 0 : stat === 'dex' ? 1 : 2;
  world.socket.out.statLock(index, next);
}

export class StatusWindow {
  constructor(world) {
    this.world = world;
    this.width = 340;
    this.height = 292;
    this.scale = 1;
    this.alwaysOnTop = false;
    this.locked = false;
    try {
      const raw = JSON.parse(localStorage.getItem(statusStorageKey(world)) || 'null');
      if (raw && typeof raw === 'object') {
        this.scale = Math.max(0.75, Math.min(1.5, Number(raw.scale) || 1));
        this.alwaysOnTop = !!raw.alwaysOnTop;
        this.locked = !!raw.locked;
      }
    } catch {
      /* ignore corrupt status settings */
    }
    const saved = loadStatusPosition(world);
    const pos = clampPosition(saved?.x ?? 20, saved?.y ?? 20, this.scaledWidth, this.scaledHeight);
    this.x = pos.x;
    this.y = pos.y;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  get player() {
    return this.world.player;
  }

  get scaledWidth() {
    return Math.round(this.width * this.scale);
  }

  get scaledHeight() {
    return Math.round(this.height * this.scale);
  }

  localPoint(mx, my) {
    return { x: this.x + (mx - this.x) / this.scale, y: this.y + (my - this.y) / this.scale };
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.scaledWidth && my < this.y + this.scaledHeight;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 7, w: 18, h: 18 };
  }

  statRects() {
    const left = this.x + 12;
    const gap = 5;
    const totalWidth = this.width - 24;
    const boxWidth = Math.floor((totalWidth - gap * 2) / 3);
    return ['str', 'dex', 'int'].map((stat, index) => ({
      stat,
      label: stat.toUpperCase(),
      x: left + index * (boxWidth + gap),
      y: this.y + 52,
      w: boxWidth,
      h: 22,
    }));
  }

  buffRects() {
    const active = (this.world.buffs || []).filter((buff) => !buff.endsAt || buff.endsAt > Date.now()).slice(0, STATUS_BUFF_MAX);
    const gap = 3;
    return active.map((buff, index) => ({
      buff,
      x: this.x + 12 + index * (STATUS_BUFF_SIZE + gap),
      y: this.y + 258,
      w: STATUS_BUFF_SIZE,
      h: STATUS_BUFF_SIZE,
    }));
  }

  tooltipAt(mx, my) {
    const point = this.localPoint(mx, my);
    const rect = this.buffRects().find((entry) => this.hitRect(entry, point.x, point.y));
    if (!rect) return null;
    const data = buffText(rect.buff, this.world.game);
    return { id: `statusbuff:${rect.buff.icon}`, title: data.title || 'Effect', lines: data.lines || [] };
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  onMouseDown(mx, my, button) {
    const point = this.localPoint(mx, my);
    mx = point.x;
    my = point.y;
    if (button === 2) {
      this.close();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const stat = this.statRects().find((rect) => this.hitRect(rect, mx, my));
    if (stat) {
      cycleStatLock(this.world, stat.stat);
      return true;
    }
    if (this.locked) return true;
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    const point = this.localPoint(mx, my);
    if (this.dragging) {
      this.x = point.x - this.dragOffset.x;
      this.y = point.y - this.dragOffset.y;
    }
  }

  onWheel(mx, my, delta, event) {
    if (!this.contains(mx, my) || !event?.ctrlKey) return false;
    const steps = [0.75, 1, 1.25, 1.5];
    let index = steps.findIndex((value) => Math.abs(value - this.scale) < 0.01);
    if (index < 0) index = 1;
    index = Math.max(0, Math.min(steps.length - 1, index + (delta > 0 ? -1 : 1)));
    this.scale = steps[index];
    this.savePosition();
    return true;
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  close() {
    this.savePosition();
    this.world.game.ui.closeStatus();
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.scaledWidth, this.scaledHeight);
    this.x = pos.x;
    this.y = pos.y;
    try {
      localStorage.setItem(
        statusStorageKey(this.world),
        JSON.stringify({
          x: this.x,
          y: this.y,
          scale: this.scale,
          alwaysOnTop: this.alwaysOnTop,
          locked: this.locked,
        })
      );
    } catch {
      /* ignore quota errors */
    }
  }

  requestStatus(force = false) {
    this.world.game.ui.requestStatus(force);
  }

  drawButton(ctx, rect, label, active) {
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

  drawBar(ctx, y, label, value, max, color) {
    const left = this.x + 12;
    const width = this.width - 24;
    const barX = left + 34;
    const barW = width - 34 - 70;
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#9e8e65';
    ctx.fillText(label, left, y);
    ctx.fillStyle = '#191308';
    ctx.fillRect(barX, y + 1, barW, 11);
    ctx.fillStyle = color;
    ctx.fillRect(barX, y + 1, barW * pct, 11);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(barX + 0.5, y + 1.5, barW - 1, 10);
    ctx.fillStyle = '#e2d6b4';
    ctx.textAlign = 'right';
    ctx.fillText(`${value}/${max}`, left + width, y);
    ctx.textAlign = 'left';
  }

  draw(ctx) {
    const p = this.player;
    if (!p) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x, -this.y);
    ctx.fillStyle = 'rgba(24,20,14,0.96)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    const left = this.x + 12;
    const width = this.width - 24;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const statusName = p.name || 'Unknown';
    const statusTitle = p.title || '';
    const titleWidth = width - 28;
    if (
      !drawServerText(ctx, statusName, {
        x: left,
        y: this.y + 10,
        width: titleWidth,
        height: 18,
        defaultColor: '#e8d7a8',
        fontSize: 15,
        bold: true,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(fitText(ctx, statusName, titleWidth), left, this.y + 10);
    }
    if (
      !drawServerText(ctx, statusTitle, {
        x: left,
        y: this.y + 30,
        width: titleWidth,
        height: 16,
        defaultColor: '#bfa96f',
        fontSize: 11,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#bfa96f';
      ctx.font = '11px monospace';
      ctx.fillText(fitText(ctx, statusTitle, titleWidth), left, this.y + 30);
    }
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(left, this.y + 48, width, 1);

    for (const rect of this.statRects()) {
      const state = this.world.statLocks?.[rect.stat] || 0;
      const label = SKILL_LOCK_LABELS[state] || 'UP';
      const value = p[rect.stat === 'str' ? 'strength' : rect.stat === 'dex' ? 'dexterity' : 'intelligence'] ?? 0;
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = state === 2 ? '#c8a8ff' : state === 1 ? '#d6a35a' : '#8fd6ff';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = '#d9c58d';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${rect.label} ${value}`, rect.x + 8, rect.y + rect.h / 2);
      ctx.fillStyle = state === 2 ? '#c8a8ff' : state === 1 ? '#d6a35a' : '#8fd6ff';
      ctx.textAlign = 'right';
      ctx.fillText(label, rect.x + rect.w - 8, rect.y + rect.h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    this.drawBar(ctx, this.y + 78, 'HP', p.hits, p.hitsMax, '#c34434');
    this.drawBar(ctx, this.y + 100, 'SP', p.stamina, p.staminaMax, '#5fa84e');
    this.drawBar(ctx, this.y + 122, 'MP', p.mana, p.manaMax, '#4f8fe0');

    ctx.font = '11px monospace';
    ctx.fillStyle = '#bfa96f';
    ctx.fillText(`Weight ${p.weight}/${p.weightMax}    Gold ${p.gold}`, left, this.y + 146);
    ctx.fillText(
      `Followers ${this.world.followers ?? 0}/${this.world.followersMax ?? 0}    Luck ${this.world.luck ?? 0}    Tithing ${this.world.tithing ?? 0}`,
      left,
      this.y + 162
    );
    ctx.fillStyle = '#9e8e65';
    ctx.font = '10px monospace';
    ctx.fillText(
      `Resists  P ${this.world.resist.physical ?? 0}  F ${this.world.resist.fire ?? 0}  C ${this.world.resist.cold ?? 0}  P ${this.world.resist.poison ?? 0}  E ${this.world.resist.energy ?? 0}`,
      left,
      this.y + 182
    );
    ctx.fillText(
      `Damage ${this.world.damageMin ?? 0}-${this.world.damageMax ?? 0}   DCI ${this.world.dci ?? 0}   HCI ${this.world.hci ?? 0}   SSI ${this.world.ssi ?? 0}`,
      left,
      this.y + 196
    );
    ctx.fillStyle = '#8d8060';
    ctx.fillText(
      `DI ${this.world.di ?? 0}  LRC ${this.world.lrc ?? 0}  SDI ${this.world.sdi ?? 0}  FCR ${this.world.fcr ?? 0}  FC ${this.world.fc ?? 0}  LMC ${this.world.lmc ?? 0}`,
      left,
      this.y + 210
    );
    ctx.fillStyle = '#8d8060';
    ctx.fillText(`${p.x}, ${p.y}, ${p.z}`, left, this.y + 226);
    const statTotal = (p.strength || 0) + (p.dexterity || 0) + (p.intelligence || 0);
    ctx.fillStyle = p.isDead ? '#d66a5a' : '#8d8060';
    ctx.fillText(
      `${p.isDead ? 'Ghost' : 'Alive'}   Stats ${statTotal}/${this.world.statsCap ?? 0}   Notoriety ${p.notoriety ?? 0}${this.locked ? '   [locked]' : ''}${this.alwaysOnTop ? '   [top]' : ''}`,
      left,
      this.y + 242
    );

    this.drawButton(ctx, this.closeRect(), 'X', false);

    const buffs = this.buffRects();
    if (buffs.length) {
      for (const rect of buffs) {
        const img = rect.buff.graphic ? this.world.assets.getGump(rect.buff.graphic) : null;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        if (img) {
          const scale = Math.min(rect.w / img.width, rect.h / img.height);
          ctx.drawImage(img, rect.x + (rect.w - img.width * scale) / 2, rect.y + (rect.h - img.height * scale) / 2, img.width * scale, img.height * scale);
        } else {
          ctx.fillStyle = '#e8d7a8';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const title = buffText(rect.buff, this.world.game).title || '?';
          ctx.fillText(title.charAt(0).toUpperCase(), rect.x + rect.w / 2, rect.y + rect.h / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
        }
      }
    }
    ctx.restore();
  }
}

function healthBarColor(mobile) {
  if (mobile.isDead || mobile.isGhost) return '#6d6147';
  return notorietyColor(mobile.notoriety);
}

export class HealthBarWindow {
  constructor(world, mobile, x, y) {
    this.world = world;
    this.serial = mobile.serial >>> 0;
    this.width = 150;
    this.height = 38;
    this.x = x;
    this.y = y;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  get mobile() {
    return this.world.getMobile(this.serial);
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 17, y: this.y + 4, w: 12, h: 12 };
  }

  onMouseDown(mx, my, button) {
    const close = this.closeRect();
    if (button === 2 || (mx >= close.x && my >= close.y && mx < close.x + close.w && my < close.y + close.h)) {
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
  }

  onMouseUp() {
    this.dragging = false;
  }

  close() {
    this.world.game.ui?.closeHealthBar(this.serial);
  }

  draw(ctx) {
    const mobile = this.mobile;
    if (!mobile) return;
    ctx.fillStyle = 'rgba(24,20,14,0.94)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = healthBarColor(mobile);
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    const name = mobile.name || `Mobile 0x${this.serial.toString(16)}`;
    ctx.fillStyle = mobile.isDead || mobile.isGhost ? '#9aa0a6' : '#e8d7a8';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fitText(ctx, name, this.width - 34), this.x + 7, this.y + 6);

    ctx.fillStyle = '#9e8e65';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('x', this.x + this.width - 8, this.y + 6);
    ctx.textAlign = 'left';

    const barX = this.x + 7;
    const barY = this.y + 23;
    const barW = this.width - 14;
    const barH = 8;
    const pct = mobile.hitsMax > 0 ? Math.max(0, Math.min(1, mobile.hits / mobile.hitsMax)) : 0;
    ctx.fillStyle = '#191308';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = mobile.isDead || mobile.isGhost ? '#5f5133' : mobile.yellowBar ? '#e8c34a' : '#c73a3a';
    ctx.fillRect(barX, barY, barW * pct, barH);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
  }
}

const OPTION_TABS = [
  { id: 'general', label: 'General' },
  { id: 'display', label: 'Display' },
  { id: 'audio', label: 'Audio' },
  { id: 'keys', label: 'Keys' },
];

export class OptionsWindow {
  constructor(world) {
    this.world = world;
    this.width = 400;
    this.height = 480;
    const savedX = settings.get('optionsX');
    const savedY = settings.get('optionsY');
    const pos = clampPosition(
      savedX ?? Math.max(20, (window.innerWidth - this.width) / 2),
      savedY ?? Math.max(20, (window.innerHeight - this.height) / 2),
      this.width,
      this.height
    );
    this.x = pos.x;
    this.y = pos.y;
    this.tab = settings.get('optionsTab');
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.sliderDrag = false;
    this.sliderRow = null;
    this.hover = null;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 27, y: this.y + 8, w: 18, h: 18 };
  }

  tabRects() {
    return OPTION_TABS.map((tab, index) => ({
      ...tab,
      x: this.x + 14 + index * 90,
      y: this.y + 42,
      w: 86,
      h: 22,
    }));
  }

  optionRows() {
    if (this.tab === 'general') {
      return [
        { type: 'toggle', key: 'alwaysRun', label: 'Always run', hint: 'Move at running speed without holding Shift' },
        { type: 'toggle', key: 'autoOpenDoors', label: 'Auto open doors', hint: 'Open a door when walking or turning into it' },
        { type: 'toggle', action: 'journalTimestamps', label: 'Journal timestamps' },
        { type: 'button', action: 'journalSettings', label: 'Journal settings...' },
        { type: 'button', action: 'joystickPosition', label: 'Joystick position', buttonLabel: 'Move' },
      ];
    }
    if (this.tab === 'display') {
      return [
        {
          type: 'slider',
          key: 'frameLimit',
          label: 'Frame limit',
          min: 0,
          max: 240,
          step: 1,
          format: (value) => (value > 0 ? `${value} fps` : 'Unlimited'),
        },
        {
          type: 'slider',
          key: 'gameZoom',
          label: 'Game zoom',
          min: 0.5,
          max: 2,
          step: 0.1,
          format: (value) => `${Math.round(value * 100)}%`,
        },
        {
          type: 'toggle',
          key: 'mobileContainerView',
          label: 'Touch container view',
          hint: 'Large tap-friendly item grid on touch devices',
        },
        { type: 'toggle', key: 'showNames', label: 'Show mobile names' },
        { type: 'toggle', key: 'showHealthBars', label: 'Show health bars' },
        { type: 'toggle', key: 'dragSelectHealthBars', label: 'Drag-select health bars' },
        { type: 'toggle', key: 'showSpeech', label: 'Show overhead speech' },
        { type: 'toggle', key: 'lighting', label: 'Day/night lighting' },
        { type: 'toggle', key: 'weather', label: 'Weather effects' },
        { type: 'toggle', key: 'questArrow', label: 'Quest arrow' },
        { type: 'toggle', key: 'waypoints', label: 'Waypoint markers' },
      ];
    }
    if (this.tab === 'keys') {
      return [
        { type: 'key', key: 'keyJournal', label: 'Journal' },
        { type: 'key', key: 'keyHelp', label: 'Help' },
        { type: 'key', key: 'keyWar', label: 'War/peace' },
        { type: 'key', key: 'keyLastTarget', label: 'Last target' },
        { type: 'key', key: 'keyAllNames', label: 'Toggle names' },
        { type: 'note', label: 'Click a shortcut, then press the new key combination.' },
      ];
    }
    return [
      { type: 'toggle', key: 'audioEnabled', label: 'Enable audio', hint: 'Uses decoded sound.mul samples with synthesized fallback' },
      {
        type: 'slider',
        key: 'audioVolume',
        label: 'Volume',
        min: 0,
        max: 100,
        step: 1,
        format: (value) => `${value}%`,
      },
      { type: 'toggle', key: 'footsteps', label: 'Footstep sounds' },
      { type: 'note', label: 'Options are saved per account.' },
    ];
  }

  rowRects() {
    let y = this.y + 82;
    const rows = [];
    for (const row of this.optionRows()) {
      const h = row.type === 'slider' ? 42 : row.type === 'note' ? 24 : 30;
      rows.push({ ...row, x: this.x + 16, y, w: this.width - 32, h });
      y += h + 2;
    }
    return rows;
  }

  sliderTrack(row) {
    return { x: row.x + 110, y: row.y + row.h / 2 - 4, w: row.w - 110 - 74, h: 8 };
  }

  sliderValue(row) {
    const min = row.min ?? 0;
    const max = row.max ?? 100;
    const step = row.step ?? 1;
    const value = Number(settings.get(row.key));
    if (!Number.isFinite(value)) return min;
    const stepped = step > 0 ? Math.round(value / step) * step : value;
    return Math.max(min, Math.min(max, stepped));
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  tabAt(mx, my) {
    return this.tabRects().find((rect) => this.hitRect(rect, mx, my)) || null;
  }

  rowAt(mx, my) {
    return this.rowRects().find((rect) => this.hitRect(rect, mx, my)) || null;
  }

  onMouseDown(mx, my, button) {
    if (this.keyCapture) {
      window.removeEventListener('keydown', this.keyCapture, true);
      this.keyCapture = null;
    }
    if (button === 2 || this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const tab = this.tabAt(mx, my);
    if (tab) {
      this.tab = tab.id;
      settings.set('optionsTab', tab.id);
      return true;
    }
    const row = this.rowAt(mx, my);
    if (row) {
      if (row.type === 'toggle') this.activateRow(row);
      else if (row.type === 'button') this.activateRow(row);
      else if (row.type === 'key') this.captureKey(row);
      else if (row.type === 'slider') {
        this.sliderDrag = true;
        this.sliderRow = row;
        this.setSliderFromMouse(mx, row);
      }
      return true;
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (this.sliderDrag) {
      if (this.sliderRow) this.setSliderFromMouse(mx, this.sliderRow);
      return;
    }
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
      return;
    }
    this.hover = this.rowAt(mx, my)?.label || this.tabAt(mx, my)?.id || null;
  }

  onMouseUp() {
    if (this.sliderDrag) {
      this.sliderDrag = false;
      this.sliderRow = null;
      settings.save();
    }
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  activateRow(row) {
    const ui = this.world.game.ui;
    if (row.action === 'journalTimestamps') {
      const journal = ui?.journal;
      if (!journal) return;
      journal.settings.timestamps = !journal.settings.timestamps;
      journal.save();
      journal.applySettings();
      return;
    }
    if (row.action === 'journalSettings') {
      ui?.journal?.showSettings?.();
      return;
    }
    if (row.action === 'joystickPosition') {
      this.close();
      ui?.beginJoystickConfig?.();
      return;
    }
    if (!row.key) return;
    const value = settings.toggle(row.key);
    if (row.key === 'alwaysRun') this.world.alwaysRun = value;
    if (row.key === 'audioEnabled' && value) this.world.game.audio?.ensure();
  }

  captureKey(row) {
    if (this.keyCapture) window.removeEventListener('keydown', this.keyCapture, true);
    this.keyCapture = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        window.removeEventListener('keydown', this.keyCapture, true);
        this.keyCapture = null;
        return;
      }
      const parts = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) parts.push(event.code);
      if (parts.length) settings.set(row.key, parts.join('+'));
      window.removeEventListener('keydown', this.keyCapture, true);
      this.keyCapture = null;
    };
    window.addEventListener('keydown', this.keyCapture, true);
  }

  setSliderFromMouse(mx, row) {
    const track = this.sliderTrack(row);
    const min = row.min ?? 0;
    const max = row.max ?? 100;
    const step = row.step ?? 1;
    const ratio = Math.max(0, Math.min(1, (mx - track.x) / Math.max(1, track.w)));
    let value = min + (max - min) * ratio;
    if (step > 0) value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));
    settings.set(row.key, value, false);
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    settings.set('optionsX', Math.round(this.x));
    settings.set('optionsY', Math.round(this.y));
  }

  close() {
    if (this.keyCapture) {
      window.removeEventListener('keydown', this.keyCapture, true);
      this.keyCapture = null;
    }
    this.savePosition();
    this.world.game.ui?.closeOptions?.();
  }

  rowValue(row) {
    if (row.action === 'journalTimestamps') {
      return !!this.world.game.ui?.journal?.settings?.timestamps;
    }
    return !!settings.get(row.key);
  }

  drawToggle(ctx, row) {
    const hovered = this.hover === row.label;
    if (hovered) {
      ctx.fillStyle = 'rgba(201,176,108,0.10)';
      ctx.fillRect(row.x - 4, row.y, row.w + 8, row.h);
    }
    const box = { x: row.x + row.w - 20, y: row.y + 7, w: 16, h: 16 };
    const on = this.rowValue(row);
    ctx.fillStyle = on ? 'rgba(201,176,108,0.32)' : 'rgba(0,0,0,0.35)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = on ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    if (on) {
      ctx.strokeStyle = '#f0dfa8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(box.x + 3, box.y + 8);
      ctx.lineTo(box.x + 6, box.y + 12);
      ctx.lineTo(box.x + 13, box.y + 3);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(row.label, row.x, row.y + (row.hint ? 4 : 8));
    if (row.hint) {
      ctx.fillStyle = '#8d8060';
      ctx.font = '9px monospace';
      ctx.fillText(fitText(ctx, row.hint, row.w - 28), row.x, row.y + 18);
    }
  }

  drawSlider(ctx, row) {
    const hovered = this.hover === row.label;
    if (hovered) {
      ctx.fillStyle = 'rgba(201,176,108,0.10)';
      ctx.fillRect(row.x - 4, row.y, row.w + 8, row.h);
    }
    const track = this.sliderTrack(row);
    const min = row.min ?? 0;
    const max = row.max ?? 100;
    const value = this.sliderValue(row);
    const pct = max > min ? (value - min) / (max - min) : 0;
    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, row.x, row.y + row.h / 2);
    ctx.fillStyle = '#191308';
    ctx.fillRect(track.x, track.y, track.w, track.h);
    ctx.fillStyle = '#c9a94f';
    ctx.fillRect(track.x, track.y, track.w * pct, track.h);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(track.x + 0.5, track.y + 0.5, track.w - 1, track.h - 1);
    ctx.fillStyle = '#f0dfa8';
    ctx.fillRect(track.x + Math.max(0, Math.min(track.w - 4, track.w * pct - 2)), track.y - 2, 4, track.h + 4);
    ctx.fillStyle = '#bfa96f';
    ctx.textAlign = 'right';
    ctx.fillText(row.format ? row.format(value) : String(value), row.x + row.w, row.y + row.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  keyLabel(binding) {
    return String(binding || '')
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace(/^Arrow/, 'Arrow ')
      .replace(/^Numpad/, 'Num ');
  }

  drawKeyRow(ctx, row) {
    const hovered = this.hover === row.label;
    if (hovered) {
      ctx.fillStyle = 'rgba(201,176,108,0.10)';
      ctx.fillRect(row.x - 4, row.y, row.w + 8, row.h);
    }
    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, row.x, row.y + row.h / 2);
    const button = { x: row.x + row.w - 132, y: row.y + 4, w: 128, h: 22 };
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = hovered ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(button.x + 0.5, button.y + 0.5, button.w - 1, button.h - 1);
    ctx.fillStyle = hovered ? '#f0dfa8' : '#d9c58d';
    ctx.textAlign = 'center';
    ctx.fillText(this.keyLabel(settings.get(row.key)), button.x + button.w / 2, button.y + button.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  drawButtonRow(ctx, row) {
    const hovered = this.hover === row.label;
    if (hovered) {
      ctx.fillStyle = 'rgba(201,176,108,0.10)';
      ctx.fillRect(row.x - 4, row.y, row.w + 8, row.h);
    }
    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, row.x, row.y + row.h / 2);
    const button = { x: row.x + row.w - 132, y: row.y + 4, w: 128, h: 22 };
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = hovered ? '#c9b06c' : '#5f5133';
    ctx.strokeRect(button.x + 0.5, button.y + 0.5, button.w - 1, button.h - 1);
    ctx.fillStyle = hovered ? '#f0dfa8' : '#d9c58d';
    ctx.textAlign = 'center';
    ctx.fillText(row.buttonLabel || 'Open', button.x + button.w / 2, button.y + button.h / 2 + 1);
    ctx.textAlign = 'left';
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
    ctx.fillText('Options', this.x + 14, this.y + 10);

    const close = this.closeRect();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(close.x, close.y, close.w, close.h);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(close.x + 0.5, close.y + 0.5, close.w - 1, close.h - 1);
    ctx.fillStyle = '#d9c58d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', close.x + close.w / 2, close.y + close.h / 2 + 1);

    for (const tab of this.tabRects()) {
      const active = tab.id === this.tab;
      const hovered = this.hover === tab.id;
      ctx.fillStyle = active ? 'rgba(201,176,108,0.28)' : hovered ? 'rgba(201,176,108,0.12)' : 'rgba(0,0,0,0.28)';
      ctx.fillRect(tab.x, tab.y, tab.w, tab.h);
      ctx.strokeStyle = active ? '#c9b06c' : '#5f5133';
      ctx.strokeRect(tab.x + 0.5, tab.y + 0.5, tab.w - 1, tab.h - 1);
      ctx.fillStyle = active ? '#f0dfa8' : '#d9c58d';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tab.label, tab.x + tab.w / 2, tab.y + tab.h / 2 + 1);
    }

    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 14, this.y + 72, this.width - 28, 1);

    for (const row of this.rowRects()) {
      if (row.type === 'toggle') this.drawToggle(ctx, row);
      else if (row.type === 'key') this.drawKeyRow(ctx, row);
      else if (row.type === 'slider') this.drawSlider(ctx, row);
      else if (row.type === 'button') this.drawButtonRow(ctx, row);
      else if (row.type === 'note') {
        ctx.fillStyle = '#8d8060';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(row.label, row.x, row.y + 6);
      }
    }

    ctx.fillStyle = '#8d8060';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Settings are saved automatically.', this.x + 14, this.y + this.height - 8);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
  }
}

const SKILL_STORAGE_BASE = 'legionuo.skills.v1';
const SKILL_LOCK_LABELS = ['UP', 'DN', 'LK'];

function skillStorageKey(world) {
  return accountStorageKey(world, SKILL_STORAGE_BASE);
}

function loadSkillPosition(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(skillStorageKey(world)) || 'null');
    if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
    return { x: Number(saved.x), y: Number(saved.y) };
  } catch {
    return null;
  }
}

export class SkillsWindow {
  constructor(world) {
    this.world = world;
    this.width = 380;
    this.height = 460;
    const saved = loadSkillPosition(world);
    const pos = clampPosition(saved?.x ?? 420, saved?.y ?? 80, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.scroll = 0;
    this.sort = 'name';
    this.descending = false;
    this.usableOnly = false;
    this.hoverButton = null;
    this.press = null;
    this.dragSkill = null;
    this.lastMouse = { x: 0, y: 0 };
    this.requestSkills();
  }

  get listLeft() {
    return this.x + 8;
  }

  get listTop() {
    return this.y + 98;
  }

  get listHeight() {
    return this.height - 108;
  }

  get rowHeight() {
    return 18;
  }

  get entries() {
    const ui = this.world.game?.ui;
    const info = ui?.skillInfo?.length ? ui.skillInfo : null;
    const server = this.world.skillList?.length ? this.world.skillList : null;
    const source = info || server || [];
    let list = source.map((skill) => ({
      index: skill.index,
      name: skill.name || `Skill ${skill.index}`,
      hasAction: skill.hasAction !== false,
    }));
    if (info && server) {
      const known = new Set(list.map((skill) => skill.index));
      for (const skill of server) {
        if (!known.has(skill.index)) {
          list.push({ index: skill.index, name: skill.name || `Skill ${skill.index}`, hasAction: skill.hasAction !== false });
        }
      }
    }
    if (this.usableOnly) list = list.filter((skill) => skill.hasAction);
    const sign = this.descending ? -1 : 1;
    list.sort((a, b) => {
      if (this.sort === 'value') {
        const av = this.world.skills.get(a.index)?.value || 0;
        const bv = this.world.skills.get(b.index)?.value || 0;
        if (av !== bv) return (av - bv) * sign;
      }
      return a.name.localeCompare(b.name) * sign;
    });
    return list;
  }

  current(skill) {
    return this.world.skills.get(skill.index) || { value: 0, base: 0, cap: 1000, lock: 0 };
  }

  maxScroll() {
    return Math.max(0, this.entries.length * this.rowHeight - this.listHeight);
  }

  clampScroll() {
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll()));
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 7, w: 18, h: 18 };
  }

  toolbarRects() {
    const y = this.y + 30;
    return [
      { id: 'name', x: this.x + 10, y, w: 64, h: 20 },
      { id: 'value', x: this.x + 80, y, w: 64, h: 20 },
      { id: 'usable', x: this.x + 150, y, w: 96, h: 20 },
    ];
  }

  statRects() {
    return ['str', 'dex', 'int'].map((stat, index) => ({
      stat,
      label: stat.toUpperCase(),
      x: this.x + 12 + index * 122,
      y: this.y + 58,
      w: 116,
      h: 22,
    }));
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  buttonAt(mx, my) {
    return this.toolbarRects().find((rect) => this.hitRect(rect, mx, my)) || null;
  }

  rowAt(mx, my) {
    if (mx < this.listLeft || mx >= this.x + this.width - 12) return null;
    if (my < this.listTop || my >= this.listTop + this.listHeight) return null;
    const index = Math.floor((my - this.listTop + this.scroll) / this.rowHeight);
    const entries = this.entries;
    if (index < 0 || index >= entries.length) return null;
    return { skill: entries[index], index, localX: mx - this.x };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const toolbar = this.buttonAt(mx, my);
    if (toolbar) {
      this.invokeToolbar(toolbar.id);
      return true;
    }
    const stat = this.statRects().find((rect) => this.hitRect(rect, mx, my));
    if (stat) {
      this.cycleStatLock(stat.stat);
      return true;
    }
    const row = this.rowAt(mx, my);
    if (row) {
      if (row.localX >= 294 && row.localX < 326) {
        this.cycleLock(row.skill);
      } else if (row.localX >= 330 && row.localX < 366) {
        this.useSkill(row.skill);
      } else if (button === 0 && row.skill.hasAction) {
        this.press = { skill: row.skill, x: mx, y: my };
      }
      return true;
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    this.lastMouse.x = mx;
    this.lastMouse.y = my;
    this.hoverButton = this.buttonAt(mx, my)?.id || null;
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
      return;
    }
    if (this.press) {
      const dx = mx - this.press.x;
      const dy = my - this.press.y;
      if (dx * dx + dy * dy >= 16) {
        this.dragSkill = this.press.skill;
        this.press = null;
      }
    }
  }

  onMouseUp(mx, my) {
    this.press = null;
    if (this.dragSkill) {
      const skill = this.dragSkill;
      this.dragSkill = null;
      this.dropSkill(skill, mx, my);
    }
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  dropSkill(skill, mx, my) {
    const ui = this.world.game?.ui;
    if (!ui) return;
    const hotbar = ui.getWindow?.('hotbar', 'player');
    if (hotbar?.contains?.(mx, my)) {
      const index = hotbar.slotAt(mx, my);
      const slot = hotbarSkillSlot(skill);
      if (index >= 0 && slot && hotbar.setSlot(index, slot)) {
        this.world.addMessage(`Bound ${slot.name} to hotbar slot ${index + 1}.`, 0x35, 1, 'System');
        return;
      }
    }
    if (!ui.hitTest?.(mx, my)) {
      ui.createSkillButton?.(skill, mx - SKILL_BUTTON_WIDTH / 2, my - SKILL_BUTTON_HEIGHT / 2);
    }
  }

  onDoubleClick(mx, my) {
    const row = this.rowAt(mx, my);
    if (row && row.localX < 294) this.useSkill(row.skill);
  }

  onWheel(mx, my, deltaY) {
    if (!this.contains(mx, my)) return false;
    this.scroll += deltaY > 0 ? this.rowHeight * 2 : -this.rowHeight * 2;
    this.clampScroll();
    return true;
  }

  invokeToolbar(id) {
    if (id === 'usable') {
      this.usableOnly = !this.usableOnly;
    } else {
      if (this.sort === id) this.descending = !this.descending;
      else {
        this.sort = id;
        this.descending = id === 'value';
      }
    }
    this.scroll = 0;
    this.clampScroll();
  }

  cycleStatLock(stat) {
    cycleStatLock(this.world, stat);
  }

  cycleLock(skill) {
    const current = this.world.skills.get(skill.index);
    const state = current?.lock ?? 0;
    const next = (state + 1) % 3;
    if (current) current.lock = next;
    else this.world.skills.set(skill.index, { id: skill.index, value: 0, base: 0, cap: 1000, lock: next });
    this.world.socket.out.skillLock(skill.index, next);
  }

  useSkill(skill) {
    if (!skill.hasAction) return;
    this.world.socket.out.useSkill(skill.index);
  }

  requestSkills() {
    const serial = this.world.playerSerial;
    if (serial) this.world.socket.out.skillsRequest(serial);
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    try {
      localStorage.setItem(skillStorageKey(this.world), JSON.stringify({ x: this.x, y: this.y }));
    } catch {
      /* ignore quota errors */
    }
  }

  close() {
    this.savePosition();
    this.world.game.ui.closeSkills();
  }

  drawToolbarButton(ctx, rect, label, active) {
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

  draw(ctx) {
    const entries = this.entries;
    this.clampScroll();

    ctx.fillStyle = 'rgba(24,20,14,0.96)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('Skills', this.x + 12, this.y + 9);
    ctx.fillStyle = '#8d8060';
    ctx.font = '10px monospace';
    ctx.fillText(`${entries.length} skills`, this.x + 74, this.y + 13);

    this.drawToolbarButton(ctx, this.closeRect(), 'X', false);

    const toolbar = this.toolbarRects();
    const nameButton = toolbar[0];
    const valueButton = toolbar[1];
    const usableButton = toolbar[2];
    this.drawToolbarButton(ctx, nameButton, `Name${this.sort === 'name' ? (this.descending ? ' v' : ' ^') : ''}`, this.sort === 'name');
    this.drawToolbarButton(ctx, valueButton, `Value${this.sort === 'value' ? (this.descending ? ' v' : ' ^') : ''}`, this.sort === 'value');
    this.drawToolbarButton(ctx, usableButton, this.usableOnly ? 'Usable only' : 'All skills', this.usableOnly);

    for (const rect of this.statRects()) {
      const state = this.world.statLocks?.[rect.stat] || 0;
      const label = SKILL_LOCK_LABELS[state] || 'UP';
      const value = this.world.player?.[rect.stat === 'str' ? 'strength' : rect.stat === 'dex' ? 'dexterity' : 'intelligence'] ?? 0;
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = state === 2 ? '#c8a8ff' : state === 1 ? '#d6a35a' : '#8fd6ff';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.fillStyle = '#d9c58d';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${rect.label} ${value}`, rect.x + 8, rect.y + rect.h / 2);
      ctx.fillStyle = state === 2 ? '#c8a8ff' : state === 1 ? '#d6a35a' : '#8fd6ff';
      ctx.textAlign = 'right';
      ctx.fillText(label, rect.x + rect.w - 8, rect.y + rect.h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    const headerY = this.y + 86;
    ctx.fillStyle = '#9e8e65';
    ctx.font = '10px monospace';
    ctx.fillText('Skill', this.x + 14, headerY);
    ctx.fillText('Value', this.x + 178, headerY);
    ctx.fillText('Base', this.x + 220, headerY);
    ctx.fillText('Cap', this.x + 260, headerY);
    ctx.fillText('Lock', this.x + 298, headerY);
    ctx.fillText('Use', this.x + 342, headerY);

    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 8, this.y + 92, this.width - 16, 1);

    const listHeight = this.listHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 8, this.listTop, this.width - 16, listHeight);
    ctx.clip();

    const rowHeight = this.rowHeight;
    const first = Math.max(0, Math.floor(this.scroll / rowHeight));
    const last = Math.min(entries.length, Math.ceil((listHeight + this.scroll) / rowHeight) + 1);
    for (let i = first; i < last; i++) {
      const skill = entries[i];
      const current = this.current(skill);
      const y = this.listTop + i * rowHeight - this.scroll;
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(this.x + 8, y, this.width - 16, rowHeight);
      }
      const locked = current.lock === 2;
      ctx.fillStyle = locked ? '#c8a8ff' : '#e2d6b4';
      ctx.font = '11px monospace';
      ctx.fillText(skill.name, this.x + 14, y + 3);
      ctx.fillStyle = locked ? '#c8a8ff' : '#e2d6b4';
      ctx.textAlign = 'right';
      ctx.fillText(((current.value || 0) / 10).toFixed(1), this.x + 212, y + 3);
      ctx.fillStyle = '#9e8e65';
      ctx.fillText(((current.base || 0) / 10).toFixed(1), this.x + 252, y + 3);
      ctx.fillText(((current.cap || 0) / 10).toFixed(1), this.x + 290, y + 3);
      ctx.textAlign = 'left';

      const lock = Math.max(0, Math.min(2, current.lock || 0));
      ctx.fillStyle = lock === 2 ? '#c8a8ff' : lock === 1 ? '#d6a35a' : '#8fd6ff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(SKILL_LOCK_LABELS[lock], this.x + 300, y + 4);

      const canUse = skill.hasAction;
      ctx.fillStyle = canUse ? '#8fd6ff' : '#5f5133';
      ctx.font = '10px monospace';
      ctx.fillText(canUse ? 'Use' : '-', this.x + 340, y + 4);
    }
    ctx.restore();

    if (this.maxScroll() > 0) {
      const trackX = this.x + this.width - 6;
      const trackY = this.listTop;
      const trackH = listHeight;
      const thumbH = Math.max(24, (trackH * trackH) / (entries.length * rowHeight));
      const thumbY = trackY + (trackH - thumbH) * (this.scroll / this.maxScroll());
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(trackX, trackY, 3, trackH);
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(trackX, thumbY, 3, thumbH);
    }

    if (this.dragSkill) {
      const label = `Use ${this.dragSkill.name}`;
      ctx.font = 'bold 11px monospace';
      const width = Math.min(220, ctx.measureText(label).width + 18);
      const x = this.lastMouse.x + 14;
      const y = this.lastMouse.y + 12;
      ctx.fillStyle = 'rgba(18,15,10,0.94)';
      ctx.fillRect(x, y, width, 22);
      ctx.strokeStyle = '#9fd08f';
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 21);
      ctx.fillStyle = '#b6d9a8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, label, width - 14), x + 7, y + 12);
      ctx.textBaseline = 'top';
    }
  }
}

const SKILL_BUTTON_STORAGE_BASE = 'legionuo.skillbuttons.v1';

function skillButtonStorageKey(world) {
  return accountStorageKey(world, SKILL_BUTTON_STORAGE_BASE);
}

export function loadSkillButtons(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(skillButtonStorageKey(world)) || 'null');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function saveSkillButtons(world, buttons) {
  try {
    localStorage.setItem(skillButtonStorageKey(world), JSON.stringify(buttons));
  } catch {
    /* ignore quota errors */
  }
}

export class SkillButtonWindow {
  constructor(world, skill, x = 40, y = 40) {
    this.world = world;
    this.skill = {
      index: Number(skill?.index) || 0,
      name: String(skill?.name || `Skill ${skill?.index ?? 0}`),
      hasAction: skill?.hasAction !== false,
    };
    this.width = SKILL_BUTTON_WIDTH;
    this.height = SKILL_BUTTON_HEIGHT;
    this.dragging = false;
    this.dragMoved = false;
    this.dragOffset = { x: 0, y: 0 };
    this.start = { x: 0, y: 0 };
    // x/y are the top-left corner, matching what persistSkillButtons stores.
    const pos = clampPosition(x, y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  tooltipAt() {
    return {
      id: `skillbutton:${this.skill.index}`,
      title: this.skill.name,
      lines: ['Skill', 'Click to use', 'Drag to the hotbar or right-click to remove'],
    };
  }

  use() {
    if (!this.skill.hasAction) return false;
    this.world.socket.out.useSkill(this.skill.index);
    return true;
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (button !== 0) return false;
    this.dragging = true;
    this.dragMoved = false;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    this.start.x = this.x;
    this.start.y = this.y;
    return true;
  }

  onMouseMove(mx, my) {
    if (!this.dragging) return;
    const dx = mx - (this.start.x + this.dragOffset.x);
    const dy = my - (this.start.y + this.dragOffset.y);
    if (!this.dragMoved && dx * dx + dy * dy < 9) return;
    this.dragMoved = true;
    const pos = clampPosition(mx - this.dragOffset.x, my - this.dragOffset.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  onMouseUp(mx, my) {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.dragMoved) {
      this.use();
      return;
    }
    const ui = this.world.game?.ui;
    const hotbar = ui?.getWindow?.('hotbar', 'player');
    if (hotbar?.contains?.(mx, my)) {
      const index = hotbar.slotAt(mx, my);
      const slot = hotbarSkillSlot(this.skill);
      if (index >= 0 && slot && hotbar.setSlot(index, slot)) {
        this.world.addMessage(`Bound ${slot.name} to hotbar slot ${index + 1}.`, 0x35, 1, 'System');
        this.x = this.start.x;
        this.y = this.start.y;
        return;
      }
    }
    ui?.persistSkillButtons?.();
  }

  close() {
    this.world.game.ui?.removeSkillButton?.(this.skill.index);
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(18,15,10,0.94)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#9fd08f';
    ctx.fillRect(this.x + 1, this.y + 1, 3, this.height - 2);
    ctx.fillStyle = '#e2d6b4';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, this.skill.name, this.width - 16), this.x + 10, this.y + this.height / 2 + 1);
    ctx.textBaseline = 'top';
  }
}

function layerName(layer) {
  const names = {
    1: 'One handed',
    2: 'Two handed',
    3: 'Shoes',
    4: 'Pants',
    5: 'Shirt',
    6: 'Helm',
    7: 'Gloves',
    8: 'Ring',
    9: 'Talisman',
    10: 'Necklace',
    11: 'Hair',
    12: 'Waist',
    13: 'Torso',
    14: 'Bracelet',
    15: 'Face',
    16: 'Beard',
    17: 'Tunic',
    18: 'Earrings',
    19: 'Arms',
    20: 'Cloak',
    21: 'Backpack',
    22: 'Robe',
    23: 'Skirt',
    24: 'Legs',
    25: 'Mount',
  };
  return names[layer] || `Layer ${layer}`;
}

const SHOP_STORAGE_BASE = 'legionuo.shop.v1';

function shopStorageKey(world) {
  return accountStorageKey(world, SHOP_STORAGE_BASE);
}

function loadShopPosition(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(shopStorageKey(world)) || 'null');
    if (!saved || !Number.isFinite(Number(saved.x)) || !Number.isFinite(Number(saved.y))) return null;
    return { x: Number(saved.x), y: Number(saved.y) };
  } catch {
    return null;
  }
}

export class ShopWindow {
  constructor(world, serial, isBuy, title) {
    this.world = world;
    this.serial = serial;
    this.isBuy = isBuy;
    this.title = title || (isBuy ? 'Buy' : 'Sell');
    this.width = 480;
    this.height = 392;
    const saved = loadShopPosition(world);
    const pos = clampPosition(saved?.x ?? 160, saved?.y ?? 120, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    this.items = [];
    this.quantities = new Map();
    this.hoverIndex = -1;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.scroll = 0;
  }

  addItem(item) {
    if (!this.quantities.has(item.serial)) this.quantities.set(item.serial, 0);
    this.items.push(item);
  }

  reset() {
    this.items = [];
    this.quantities.clear();
    this.scroll = 0;
    this.hoverIndex = -1;
  }

  get listTop() {
    return this.y + 78;
  }

  get listHeight() {
    return this.height - 78 - 88;
  }

  get rowHeight() {
    return 44;
  }

  get scrollMax() {
    return Math.max(0, this.items.length * this.rowHeight - this.listHeight);
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 28, y: this.y + 8, w: 18, h: 18 };
  }

  footerRects() {
    const y = this.y + this.height - 42;
    return {
      clear: { x: this.x + this.width - 288, y, w: 64, h: 28 },
      all: { x: this.x + this.width - 216, y, w: 64, h: 28 },
      confirm: { x: this.x + this.width - 144, y, w: 128, h: 28 },
    };
  }

  rowRect(index) {
    return {
      x: this.x + 8,
      y: this.listTop + index * this.rowHeight - this.scroll,
      w: this.width - 16,
      h: this.rowHeight - 4,
    };
  }

  controlRects(index) {
    const rect = this.rowRect(index);
    const right = rect.x + rect.w;
    return {
      minus: { x: right - 126, y: rect.y + 12, w: 22, h: 18 },
      qty: { x: right - 100, y: rect.y + 12, w: 44, h: 18 },
      plus: { x: right - 52, y: rect.y + 12, w: 22, h: 18 },
      subtotalX: right - 136,
      priceX: rect.x + 222,
    };
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  itemIndexAt(mx, my) {
    if (!this.contains(mx, my)) return -1;
    if (my < this.listTop || my >= this.listTop + this.listHeight) return -1;
    const index = Math.floor((my - this.listTop + this.scroll) / this.rowHeight);
    return index >= 0 && index < this.items.length ? index : -1;
  }

  itemAt(mx, my) {
    const index = this.itemIndexAt(mx, my);
    return index >= 0 ? this.items[index] : null;
  }

  targetAt(mx, my) {
    if (!this.contains(mx, my)) return null;
    return this.itemAt(mx, my);
  }

  unitPrice(item) {
    return Math.max(0, Number(item.price) || 0);
  }

  maxQuantity(item) {
    const available = Math.max(1, Number(item.amount) || 1);
    return this.isBuy ? Math.min(999, available) : available;
  }

  quantity(item) {
    return this.quantities.get(item.serial) || 0;
  }

  setQuantity(item, value) {
    const qty = Math.max(0, Math.min(this.maxQuantity(item), Math.floor(Number(value) || 0)));
    this.quantities.set(item.serial, qty);
  }

  adjust(item, delta) {
    this.setQuantity(item, this.quantity(item) + delta);
  }

  get total() {
    let total = 0;
    for (const item of this.items) total += this.quantity(item) * this.unitPrice(item);
    return total;
  }

  get selected() {
    return this.items
      .filter((item) => this.quantity(item) > 0)
      .map((item) => [item.serial, this.quantity(item)]);
  }

  tooltipAt(mx, my) {
    const item = this.itemAt(mx, my);
    if (!item) return null;
    const price = this.unitPrice(item);
    const qty = this.quantity(item);
    const lines = [`${price} gp each`];
    lines.push(this.isBuy ? `Stock: ${item.amount || 1}` : `Available: ${item.amount || 1}`);
    if (qty > 0) lines.push(`Selected: ${qty} for ${qty * price} gp`);
    return {
      id: `shop:${this.serial}:${item.serial}`,
      serial: item.serial,
      title: item.name,
      lines,
    };
  }

  promptQuantity(item) {
    const max = this.maxQuantity(item);
    const initial = String(this.quantity(item) || Math.min(1, max));
    this.world.game.ui.showModalInput(
      `Quantity (0-${max})`,
      initial,
      Math.max(1, String(max).length),
      (value) => this.setQuantity(item, parseInt(value, 10) || 0),
      true
    );
  }

  confirm() {
    const items = this.selected;
    const total = this.total;
    if (!items.length) {
      this.world.game.ui.addJournal(`Select at least one item to ${this.isBuy ? 'buy' : 'sell'}.`, '#c56a4a', true);
      return;
    }
    if (this.isBuy) {
      const gold = Number(this.world.player?.gold) || 0;
      if (gold > 0 && total > gold) {
        this.world.game.ui.addJournal(
          `Not enough gold: need ${total} gp but you have ${gold} gp.`,
          '#c56a4a',
          true
        );
        return;
      }
      this.world.socket.out.buy(this.serial, items);
    } else {
      this.world.socket.out.sell(this.serial, items);
    }
    this.quantities.clear();
    this.world.game.ui.requestStatus(true);
  }

  clearQuantities() {
    this.quantities.clear();
  }

  selectAll() {
    for (const item of this.items) this.setQuantity(item, this.maxQuantity(item));
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      const item = this.itemAt(mx, my);
      if (item) this.world.game.ui.openContextMenu(item.serial, mx, my);
      else this.close();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const footer = this.footerRects();
    if (this.hitRect(footer.clear, mx, my)) {
      this.clearQuantities();
      return true;
    }
    if (this.hitRect(footer.all, mx, my)) {
      this.selectAll();
      return true;
    }
    if (this.hitRect(footer.confirm, mx, my)) {
      this.confirm();
      return true;
    }

    const index = this.itemIndexAt(mx, my);
    if (index >= 0) {
      const item = this.items[index];
      const controls = this.controlRects(index);
      if (this.hitRect(controls.minus, mx, my)) {
        this.adjust(item, -1);
      } else if (this.hitRect(controls.plus, mx, my)) {
        this.adjust(item, 1);
      } else if (this.hitRect(controls.qty, mx, my)) {
        this.promptQuantity(item);
      } else {
        this.adjust(item, 1);
      }
      return true;
    }

    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    this.hoverIndex = this.itemIndexAt(mx, my);
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  onWheel(mx, my, deltaY) {
    if (!this.contains(mx, my)) return false;
    const step = deltaY > 0 ? this.rowHeight : -this.rowHeight;
    this.scroll = Math.max(0, Math.min(this.scroll + step, this.scrollMax));
    return true;
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    try {
      localStorage.setItem(shopStorageKey(this.world), JSON.stringify({ x: this.x, y: this.y }));
    } catch {
      /* ignore quota errors */
    }
  }

  close() {
    this.savePosition();
    this.world.game.ui.closeShop(this.serial);
  }

  actionButton(ctx, rect, label, enabled, active = false) {
    ctx.fillStyle = !enabled
      ? 'rgba(0,0,0,0.25)'
      : active
        ? 'rgba(201,176,108,0.32)'
        : 'rgba(0,0,0,0.3)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = enabled ? '#8d7a52' : '#4d432c';
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.fillStyle = enabled ? '#e8d7a8' : '#6d6045';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  draw(ctx) {
    this.scroll = Math.max(0, Math.min(this.scroll, this.scrollMax));
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const shopTitleWidth = this.width - 60;
    if (
      !drawServerText(ctx, this.title, {
        x: this.x + 12,
        y: this.y + 10,
        width: shopTitleWidth,
        height: 18,
        defaultColor: '#e8d7a8',
        fontSize: 14,
        bold: true,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(fitText(ctx, this.title, shopTitleWidth), this.x + 12, this.y + 10);
    }
    ctx.fillStyle = '#8d8060';
    ctx.font = '10px monospace';
    ctx.fillText(`${this.items.length} items`, this.x + 12, this.y + 30);
    ctx.fillStyle = '#c9b06c';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('X', this.x + this.width - 24, this.y + 10);

    const headerY = this.listTop - 18;
    ctx.fillStyle = '#9e8e65';
    ctx.font = '10px monospace';
    ctx.fillText('Item', this.x + 54, headerY);
    ctx.textAlign = 'right';
    ctx.fillText('Price', this.x + 270, headerY);
    ctx.fillText('Total', this.x + this.width - 144, headerY);
    ctx.textAlign = 'center';
    ctx.fillText('Qty', this.x + this.width - 86, headerY);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 8, this.listTop - 4, this.width - 16, 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 8, this.listTop, this.width - 20, this.listHeight);
    ctx.clip();

    const first = Math.max(0, Math.floor(this.scroll / this.rowHeight));
    const last = Math.min(this.items.length, Math.ceil((this.listHeight + this.scroll) / this.rowHeight) + 1);
    for (let i = first; i < last; i++) {
      const item = this.items[i];
      const rect = this.rowRect(i);
      const controls = this.controlRects(i);
      const qty = this.quantity(item);
      if (i === this.hoverIndex) {
        ctx.fillStyle = 'rgba(201,176,108,0.13)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      } else if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      }
      const img = this.world.assets.getStatic(item.graphic, item.hue);
      if (img) {
        const scale = Math.min(1, 32 / Math.max(img.width, img.height));
        ctx.drawImage(img, rect.x + 6, rect.y + 4, img.width * scale, img.height * scale);
      }
      const itemName = item.name || `0x${item.graphic.toString(16)}`;
      ctx.fillStyle = qty > 0 ? '#f0dfa8' : '#e8d7a8';
      ctx.font = '12px monospace';
      if (
        !drawServerText(ctx, itemName, {
          x: rect.x + 46,
          y: rect.y + 5,
          width: 172,
          height: 30,
          defaultColor: '#e8d7a8',
          fontSize: 12,
          fontFamily: 'monospace',
          clip: true,
        })
      ) {
        ctx.fillText(itemName, rect.x + 46, rect.y + 5);
      }
      ctx.fillStyle = '#8d8060';
      ctx.font = '9px monospace';
      ctx.fillText(this.isBuy ? `stock ${item.amount || 1}` : `have ${item.amount || 1}`, rect.x + 46, rect.y + 24);

      ctx.fillStyle = '#9fd27a';
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${this.unitPrice(item)} gp`, controls.priceX, rect.y + 8);
      ctx.fillStyle = qty > 0 ? '#e8d7a8' : '#6d6045';
      ctx.fillText(`${qty * this.unitPrice(item)} gp`, controls.subtotalX, rect.y + 8);
      ctx.textAlign = 'left';

      this.actionButton(ctx, controls.minus, '-', qty > 0);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(controls.qty.x, controls.qty.y, controls.qty.w, controls.qty.h);
      ctx.strokeStyle = qty > 0 ? '#8d7a52' : '#4d432c';
      ctx.strokeRect(controls.qty.x + 0.5, controls.qty.y + 0.5, controls.qty.w - 1, controls.qty.h - 1);
      ctx.fillStyle = qty > 0 ? '#f0dfa8' : '#8d8060';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(qty), controls.qty.x + controls.qty.w / 2, controls.qty.y + controls.qty.h / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      this.actionButton(ctx, controls.plus, '+', qty < this.maxQuantity(item));
    }
    ctx.restore();

    if (this.scrollMax > 0) {
      const trackX = this.x + this.width - 7;
      const trackY = this.listTop;
      const trackH = this.listHeight;
      const thumbH = Math.max(24, (trackH * trackH) / (this.items.length * this.rowHeight));
      const thumbY = trackY + (trackH - thumbH) * (this.scroll / this.scrollMax);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(trackX, trackY, 3, trackH);
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(trackX, thumbY, 3, thumbH);
    }

    if (!this.items.length) {
      ctx.fillStyle = '#7b6d4d';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No items available.', this.x + this.width / 2, this.listTop + 24);
      ctx.textAlign = 'left';
    }

    const footerY = this.y + this.height - 76;
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 8, footerY, this.width - 16, 1);
    const total = this.total;
    const gold = Number(this.world.player?.gold) || 0;
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`Total: ${total} gp`, this.x + 14, footerY + 10);
    ctx.fillStyle = this.isBuy && gold > 0 && total > gold ? '#d06a5a' : '#9fd27a';
    ctx.font = '11px monospace';
    ctx.fillText(`Gold: ${gold} gp`, this.x + 14, footerY + 28);

    const footer = this.footerRects();
    this.actionButton(ctx, footer.clear, 'Clear', this.selected.length > 0);
    this.actionButton(ctx, footer.all, 'All', this.items.length > 0);
    const enoughGold = !this.isBuy || gold <= 0 || total <= gold;
    this.actionButton(
      ctx,
      footer.confirm,
      this.isBuy ? 'Confirm Buy' : 'Confirm Sell',
      this.selected.length > 0 && enoughGold,
      this.selected.length > 0 && enoughGold
    );
  }
}

export class BookWindow {
  constructor(world, serial, title, author, pages, editable, old = false) {
    this.world = world;
    this.serial = serial;
    this.title = title || 'Book';
    this.author = author || '';
    this.pages = pages || 1;
    this.editable = editable;
    this.old = old;
    this.lines = new Map();
    this.page = 1;
    this.width = 360;
    this.height = 340;
    this.x = 200;
    this.y = 100;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  setPage(page, lines) {
    this.lines.set(page, lines);
  }

  applyEdit(title, author, lines) {
    this.title = title;
    this.author = author;
    if (lines) this.lines.set(this.page, lines);
  }

  get editRect() {
    return { x: this.x + 12, y: this.y + 8, w: 52, h: 18 };
  }

  get closeRect() {
    return { x: this.x + this.width - 32, y: this.y + 4, w: 26, h: 24 };
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    const lx = mx - this.x;
    const ly = my - this.y;
    if (this.editable) {
      const r = this.editRect;
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
        this.world.game.ui.editBook(this.serial);
        return true;
      }
    }
    const close = this.closeRect;
    if (mx >= close.x && mx < close.x + close.w && my >= close.y && my < close.y + close.h) {
      this.close();
      return true;
    }
    if (ly > this.height - 40) {
      if (lx < this.width / 2 && this.page > 1) {
        this.page--;
        this.world.socket.out.bookPageRequest(this.serial, this.page);
      } else if (lx >= this.width / 2 && this.page < this.pages) {
        this.page++;
        this.world.socket.out.bookPageRequest(this.serial, this.page);
      }
      return true;
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
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  close() {
    this.world.game.ui.closeBook(this.serial);
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(30,24,15,0.98)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#9a7e47';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    if (this.editable) {
      const r = this.editRect;
      ctx.fillStyle = 'rgba(80,64,34,0.85)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#9a7e47';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Edit', r.x + r.w / 2, r.y + r.h / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    const titleX = this.editable ? this.x + 72 : this.x + 20;
    const titleWidth = this.width - (titleX - this.x) - 44;
    if (
      !drawServerText(ctx, this.title, {
        x: titleX,
        y: this.y + 12,
        width: titleWidth,
        height: 18,
        align: 'center',
        defaultColor: '#e8d7a8',
        fontSize: 14,
        bold: true,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(fitText(ctx, this.title, titleWidth), titleX + titleWidth / 2, this.y + 12);
    }
    const authorText = this.author ? `by ${this.author}` : '';
    if (
      !drawServerText(ctx, authorText, {
        x: this.x + 20,
        y: this.y + 30,
        width: this.width - 40,
        height: 16,
        align: 'center',
        defaultColor: '#bfa96f',
        fontSize: 11,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#bfa96f';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(authorText, this.x + this.width / 2, this.y + 30);
    }
    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    const lines = this.lines.get(this.page) || [];
    const pageText = lines.join('\n');
    let y = this.y + 56;
    const renderedPage = drawServerText(ctx, pageText, {
      x: this.x + 20,
      y: this.y + 56,
      width: this.width - 40,
      height: this.height - 106,
      defaultColor: '#d9c58d',
      fontSize: 12,
      fontFamily: 'monospace',
      clip: true,
    });
    if (renderedPage) {
      y = this.y + 56 + renderedPage.height;
    } else {
      for (const line of lines) {
        ctx.fillText(line, this.x + 20, y);
        y += 16;
        if (y > this.y + this.height - 50) break;
      }
    }
    if (!lines.length) {
      ctx.fillStyle = '#7b6d4d';
      ctx.fillText('Loading page...', this.x + 20, y);
    }
    ctx.fillStyle = '#e8d7a8';
    ctx.textAlign = 'center';
    ctx.fillText(`< ${this.page} / ${this.pages} >`, this.x + this.width / 2, this.y + this.height - 28);
    const close = this.closeRect;
    ctx.fillStyle = '#c9b06c';
    ctx.fillText('X', close.x + close.w / 2, this.y + 10);
    ctx.textAlign = 'left';
  }
}

const BOARD_STORAGE_BASE = 'legionuo.board.v1';

function boardStorageKey(world) {
  return accountStorageKey(world, BOARD_STORAGE_BASE);
}

function loadBoardPositions(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(boardStorageKey(world)) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveBoardPosition(world, serial, x, y) {
  try {
    const all = loadBoardPositions(world);
    all[String(serial)] = { x: Math.round(x), y: Math.round(y) };
    localStorage.setItem(boardStorageKey(world), JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const token of raw.split(/(\s+)/)) {
      if (!token) continue;
      if (ctx.measureText(current + token).width <= maxWidth) {
        current += token;
        continue;
      }
      if (current.trim()) {
        lines.push(current.trimEnd());
        current = '';
      }
      let word = token.replace(/^\s+/, '');
      while (word && ctx.measureText(word).width > maxWidth) {
        let lo = 1;
        let hi = word.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (ctx.measureText(word.slice(0, mid)).width <= maxWidth) lo = mid;
          else hi = mid - 1;
        }
        lines.push(word.slice(0, lo));
        word = word.slice(lo);
      }
      current = word;
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

export class BoardWindow {
  constructor(world, serial, name) {
    this.world = world;
    this.serial = serial >>> 0;
    this.name = name || 'Bulletin Board';
    this.width = 480;
    this.height = 420;
    const saved = loadBoardPositions(world)[String(this.serial)];
    const pos = clampPosition(saved?.x ?? 260, saved?.y ?? 90, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.mode = 'list';
    this.messages = [];
    this.bySerial = new Map();
    this.current = null;
    this.selectedSerial = 0;
    this.scroll = 0;
    this.readScroll = 0;
    this.readLineCount = 0;
    this.hover = null;
  }

  get listTop() {
    return this.y + 48;
  }

  get listHeight() {
    return this.height - 60;
  }

  get rowHeight() {
    return 40;
  }

  get readBodyHeight() {
    return this.height - 136;
  }

  maxScroll() {
    return Math.max(0, this.messages.length * this.rowHeight - this.listHeight);
  }

  clampScroll() {
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll()));
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 32, y: this.y + 8, w: 22, h: 22 };
  }

  postRect() {
    return { x: this.x + this.width - 104, y: this.y + 8, w: 64, h: 22 };
  }

  backRect() {
    return { x: this.x + 12, y: this.y + 42, w: 54, h: 22 };
  }

  removeRect() {
    return { x: this.x + 72, y: this.y + 42, w: 70, h: 22 };
  }

  hitRect(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  rowAt(mx, my) {
    if (mx < this.x + 8 || mx >= this.x + this.width - 12) return null;
    if (my < this.listTop || my >= this.listTop + this.listHeight) return null;
    const index = Math.floor((my - this.listTop + this.scroll) / this.rowHeight);
    if (index < 0 || index >= this.messages.length) return null;
    return { index, message: this.messages[index] };
  }

  addSummary(message) {
    const serial = message.serial >>> 0;
    const existing = this.bySerial.get(serial);
    if (existing) {
      Object.assign(existing, message);
      return existing;
    }
    const entry = { ...message, serial };
    this.messages.push(entry);
    this.bySerial.set(serial, entry);
    this.clampScroll();
    return entry;
  }

  setMessage(message) {
    const entry = this.addSummary(message);
    entry.lines = message.lines || [];
    this.current = entry;
    this.selectedSerial = entry.serial;
    this.mode = 'read';
    this.readScroll = 0;
  }

  removeMessage(serial) {
    serial = serial >>> 0;
    this.messages = this.messages.filter((msg) => msg.serial !== serial);
    this.bySerial.delete(serial);
    if (this.selectedSerial === serial) this.selectedSerial = 0;
    this.clampScroll();
  }

  openMessage(message) {
    this.selectedSerial = message.serial >>> 0;
    this.mode = 'read';
    this.readScroll = 0;
    this.current = { ...message, lines: message.lines || [], loading: true };
    this.world.socket.out.bulletinRequest(this.serial, message.serial);
  }

  compose() {
    const ui = this.world.game?.ui;
    if (!ui) return;
    const subject = document.createElement('input');
    subject.maxLength = 255;
    const text = document.createElement('textarea');
    text.maxLength = 4096;
    text.rows = 10;
    const body = document.createElement('div');
    body.appendChild(ui.formField('Subject', subject));
    body.appendChild(ui.formField('Message', text));
    ui.showModal(
      'Post Message',
      body,
      () => {
        const title = subject.value.trim();
        const lines = text.value.replace(/\r\n?/g, '\n').split('\n');
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        if (!title && !lines.length) return;
        this.world.socket.out.bulletinPost(this.serial, 0, title || 'No subject', lines);
        this.mode = 'list';
        this.current = null;
        this.readScroll = 0;
      },
      true
    );
  }

  confirmRemove() {
    const ui = this.world.game?.ui;
    const message = this.current;
    if (!ui || !message) return;
    const body = document.createElement('div');
    body.textContent = `Remove "${message.subject || 'this message'}"?`;
    ui.showModal(
      'Remove Message',
      body,
      () => {
        this.world.socket.out.bulletinRemove(this.serial, message.serial);
        this.removeMessage(message.serial);
        this.mode = 'list';
        this.current = null;
        this.readScroll = 0;
      },
      true
    );
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (this.hitRect(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    if (this.mode === 'list') {
      if (this.hitRect(this.postRect(), mx, my)) {
        this.compose();
        return true;
      }
      const row = this.rowAt(mx, my);
      if (row) {
        this.selectedSerial = row.message.serial >>> 0;
        return true;
      }
    } else {
      if (this.hitRect(this.backRect(), mx, my)) {
        this.mode = 'list';
        this.current = null;
        this.readScroll = 0;
        return true;
      }
      if (this.hitRect(this.removeRect(), mx, my)) {
        this.confirmRemove();
        return true;
      }
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
    this.hover = this.mode === 'list' ? this.rowAt(mx, my)?.index ?? null : null;
  }

  onMouseUp() {
    if (this.dragging) this.savePosition();
    this.dragging = false;
  }

  onDoubleClick(mx, my) {
    if (this.mode !== 'list') return;
    const row = this.rowAt(mx, my);
    if (row) this.openMessage(row.message);
  }

  onWheel(mx, my, deltaY) {
    if (!this.contains(mx, my)) return false;
    if (this.mode === 'read') {
      const max = Math.max(0, this.readLineCount * 16 - this.readBodyHeight);
      this.readScroll = Math.max(0, Math.min(this.readScroll + (deltaY > 0 ? 48 : -48), max));
    } else {
      this.scroll += deltaY > 0 ? this.rowHeight * 2 : -this.rowHeight * 2;
      this.clampScroll();
    }
    return true;
  }

  savePosition() {
    const pos = clampPosition(this.x, this.y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
    saveBoardPosition(this.world, this.serial, this.x, this.y);
  }

  close() {
    this.savePosition();
    this.world.game.ui.closeBoard(this.serial);
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

  drawList(ctx) {
    const titleX = this.x + 12;
    const titleWidth = this.postRect().x - titleX - 8;
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(fitText(ctx, this.name, titleWidth), titleX, this.y + 9);
    ctx.fillStyle = '#8d8060';
    ctx.font = '10px monospace';
    ctx.fillText(`${this.messages.length} message${this.messages.length === 1 ? '' : 's'}`, titleX, this.y + 28);

    this.drawButton(ctx, this.postRect(), 'Post');
    this.drawButton(ctx, this.closeRect(), 'X');

    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 8, this.y + 39, this.width - 16, 1);

    this.clampScroll();
    const listTop = this.listTop;
    const listHeight = this.listHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 8, listTop, this.width - 16, listHeight);
    ctx.clip();

    const first = Math.max(0, Math.floor(this.scroll / this.rowHeight));
    const last = Math.min(this.messages.length, Math.ceil((listHeight + this.scroll) / this.rowHeight) + 1);
    for (let i = first; i < last; i++) {
      const message = this.messages[i];
      const y = listTop + i * this.rowHeight - this.scroll;
      const selected = (message.serial >>> 0) === (this.selectedSerial >>> 0);
      if (selected || this.hover === i) {
        ctx.fillStyle = selected ? 'rgba(201,176,108,0.18)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(this.x + 8, y, this.width - 16, this.rowHeight);
      }
      ctx.fillStyle = selected ? '#f0dfa8' : '#e2d6b4';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(fitText(ctx, message.subject || '(no subject)', this.width - 34), this.x + 14, y + 6);
      ctx.fillStyle = '#9e8e65';
      ctx.font = '10px monospace';
      const meta = [message.poster, message.date].filter(Boolean).join('  -  ');
      ctx.fillText(fitText(ctx, meta, this.width - 34), this.x + 14, y + 23);
    }
    ctx.restore();

    if (!this.messages.length) {
      ctx.fillStyle = '#7b6d4d';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No messages.', this.x + this.width / 2, listTop + 24);
      ctx.textAlign = 'left';
    }

    if (this.maxScroll() > 0) {
      const trackX = this.x + this.width - 7;
      const thumbH = Math.max(24, (listHeight * listHeight) / (this.messages.length * this.rowHeight));
      const thumbY = listTop + (listHeight - thumbH) * (this.scroll / this.maxScroll());
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(trackX, listTop, 3, listHeight);
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(trackX, thumbY, 3, thumbH);
    }
  }

  drawRead(ctx) {
    const message = this.current;
    this.drawButton(ctx, this.backRect(), 'Back');
    this.drawButton(ctx, this.removeRect(), 'Remove');
    this.drawButton(ctx, this.closeRect(), 'X');

    const subject = message?.subject || '(no subject)';
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(fitText(ctx, subject, this.width - 24), this.x + 12, this.y + 72);

    const meta = [message?.poster, message?.date].filter(Boolean).join('  -  ');
    ctx.fillStyle = '#9e8e65';
    ctx.font = '10px monospace';
    ctx.fillText(fitText(ctx, meta, this.width - 24), this.x + 12, this.y + 92);

    ctx.fillStyle = '#5f5133';
    ctx.fillRect(this.x + 8, this.y + 110, this.width - 16, 1);

    const bodyTop = this.y + 120;
    const bodyHeight = this.readBodyHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 8, bodyTop, this.width - 16, bodyHeight);
    ctx.clip();

    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    const lines = message?.loading && !(message.lines || []).length
      ? ['Loading message...']
      : wrapCanvasText(ctx, (message?.lines || []).join('\n'), this.width - 32);
    this.readLineCount = lines.length;
    const maxScroll = Math.max(0, lines.length * 16 - bodyHeight);
    this.readScroll = Math.max(0, Math.min(this.readScroll, maxScroll));
    for (let i = 0; i < lines.length; i++) {
      const y = bodyTop + 4 + i * 16 - this.readScroll;
      if (y < bodyTop - 16 || y > bodyTop + bodyHeight) continue;
      ctx.fillText(lines[i], this.x + 12, y);
    }
    ctx.restore();

    if (maxScroll > 0) {
      const trackX = this.x + this.width - 7;
      const thumbH = Math.max(24, (bodyHeight * bodyHeight) / (lines.length * 16));
      const thumbY = bodyTop + (bodyHeight - thumbH) * (this.readScroll / maxScroll);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(trackX, bodyTop, 3, bodyHeight);
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(trackX, thumbY, 3, thumbH);
    }
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.96)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (this.mode === 'read') this.drawRead(ctx);
    else this.drawList(ctx);
  }
}

export class ProfileWindow {
  constructor(world, serial, header, footer, body, editable = false) {
    this.world = world;
    this.serial = serial;
    this.header = header || '';
    this.footer = footer || '';
    this.body = body || '';
    this.editable = editable;
    this.x = 220;
    this.y = 120;
    this.width = 360;
    this.height = 320;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  setBody(body) {
    this.body = body || '';
  }

  get editRect() {
    return { x: this.x + 12, y: this.y + 8, w: 52, h: 18 };
  }

  get closeRect() {
    return { x: this.x + this.width - 32, y: this.y + 4, w: 26, h: 24 };
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    if (this.editable) {
      const r = this.editRect;
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
        this.world.game.ui.editProfile(this.serial);
        return true;
      }
    }
    const close = this.closeRect;
    if (mx >= close.x && mx < close.x + close.w && my >= close.y && my < close.y + close.h) {
      this.close();
      return true;
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
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  close() {
    this.world.game.ui.closeProfile(this.serial);
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(24,20,14,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    if (this.editable) {
      const r = this.editRect;
      ctx.fillStyle = 'rgba(80,64,34,0.85)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#9a7e47';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Edit', r.x + r.w / 2, r.y + r.h / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    const headerText = this.header;
    const headerX = this.editable ? this.x + 72 : this.x + 12;
    const headerWidth = this.width - (headerX - this.x) - 36;
    if (
      !drawServerText(ctx, headerText, {
        x: headerX,
        y: this.y + 10,
        width: headerWidth,
        height: 18,
        defaultColor: '#e8d7a8',
        fontSize: 14,
        bold: true,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(fitText(ctx, headerText, headerWidth), headerX, this.y + 10);
    }
    ctx.fillStyle = '#c9b06c';
    ctx.font = 'bold 14px monospace';
    const close = this.closeRect;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('X', close.x + close.w / 2, this.y + 10);
    ctx.textAlign = 'left';
    ctx.font = '12px monospace';
    ctx.fillStyle = '#e8d7a8';
    const renderedBody = drawServerText(ctx, this.body, {
      x: this.x + 12,
      y: this.y + 34,
      width: this.width - 24,
      height: this.height - 64,
      defaultColor: '#e8d7a8',
      fontSize: 12,
      fontFamily: 'monospace',
      clip: true,
    });
    if (!renderedBody) {
      let y = this.y + 34;
      for (const line of wrap(this.body, 48)) {
        ctx.fillText(line, this.x + 12, y);
        y += 16;
        if (y > this.y + this.height - 30) break;
      }
    }
    if (this.footer) {
      ctx.fillStyle = '#bfa96f';
      ctx.font = '12px monospace';
      if (
        !drawServerText(ctx, this.footer, {
          x: this.x + 12,
          y: this.y + this.height - 24,
          width: this.width - 24,
          height: 16,
          defaultColor: '#bfa96f',
          fontSize: 12,
          fontFamily: 'monospace',
          clip: true,
        })
      ) {
        ctx.fillText(this.footer, this.x + 12, this.y + this.height - 24);
      }
    }
  }
}


export class ContextMenuWindow {
  constructor(world, serial, items, x, y, onSelect) {
    this.world = world;
    this.serial = serial >>> 0;
    this.items = items.map((item) => {
      const text = world.game?.cliloc?.(item.cliloc) ?? item.text ?? `Cliloc ${item.cliloc}`;
      return { ...item, text };
    });
    this.onSelect = onSelect;
    this.rowHeight = 22;
    this.padding = 8;
    this.hover = -1;
    let width = 150;
    const ctx = world.game?.renderer?.ctx;
    if (ctx) {
      ctx.save();
      ctx.font = '12px monospace';
      for (const item of this.items) width = Math.max(width, ctx.measureText(item.text).width + 42);
      ctx.restore();
    }
    this.width = Math.min(Math.max(150, Math.ceil(width)), Math.min(420, window.innerWidth - 16));
    this.height = Math.max(this.rowHeight + this.padding * 2, this.items.length * this.rowHeight + this.padding * 2);
    const pos = clampPosition(x, y, this.width, this.height);
    this.x = pos.x;
    this.y = pos.y;
  }

  rowAt(mx, my) {
    if (!this.contains(mx, my)) return -1;
    const index = Math.floor((my - this.y - this.padding) / this.rowHeight);
    return index >= 0 && index < this.items.length ? index : -1;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  onMouseMove(mx, my) {
    this.hover = this.rowAt(mx, my);
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    const index = this.rowAt(mx, my);
    if (index >= 0) {
      this.onSelect?.(this.serial, this.items[index].index);
      this.close();
    }
    return true;
  }

  close() {
    this.world.game.ui.closeContextMenu();
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(22,18,12,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    this.items.forEach((item, index) => {
      const top = this.y + this.padding + index * this.rowHeight;
      if (index === this.hover) {
        ctx.fillStyle = 'rgba(124, 100, 58, 0.45)';
        ctx.fillRect(this.x + 3, top + 1, this.width - 6, this.rowHeight - 2);
      }
      let text = item.text;
      const maxWidth = this.width - 30;
      if (ctx.measureText(text).width > maxWidth) {
        while (text.length > 1 && ctx.measureText(`${text}...`).width > maxWidth) text = text.slice(0, -1);
        text = `${text}...`;
      }
      ctx.fillStyle = (item.flags & 0x01) ? this.world.game?.ui?.hueColor(0x0386) || '#7bd7ff' : '#d9c58d';
      ctx.fillText(text, this.x + 12, top + this.rowHeight / 2);
      if (item.flags & 0x02) {
        ctx.fillStyle = '#bfa96f';
        ctx.textAlign = 'right';
        ctx.fillText('>', this.x + this.width - 10, top + this.rowHeight / 2);
        ctx.textAlign = 'left';
      }
    });
    ctx.restore();
  }
}

export class DebugGumpWindow {
  constructor(world, gump, onClose) {
    this.world = world;
    this.gump = gump;
    this.onClose = onClose;
    this.closed = false;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.width = Math.min(560, Math.max(320, window.innerWidth - 40));
    this.height = Math.min(420, Math.max(220, window.innerHeight - 100));
    this.x = Math.max(10, window.innerWidth - this.width - 20);
    this.y = 60;

    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed',
      `left:${this.x}px`,
      `top:${this.y}px`,
      `width:${this.width}px`,
      `height:${this.height}px`,
      'display:flex',
      'flex-direction:column',
      'box-sizing:border-box',
      'background:rgba(12,15,10,0.98)',
      'border:1px solid #6f8056',
      'box-shadow:0 8px 30px rgba(0,0,0,0.6)',
      'z-index:70',
      'font-family:monospace',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#181d13;border-bottom:1px solid #3c4730;cursor:move;user-select:none;';

    this.title = document.createElement('span');
    this.title.style.cssText = 'color:#cfe4b7;font:bold 13px monospace;';

    const closeButton = document.createElement('button');
    closeButton.textContent = 'X';
    closeButton.title = 'Close';
    closeButton.style.cssText =
      'background:transparent;border:0;color:#c9b06c;font:13px monospace;cursor:pointer;padding:0 2px;';
    closeButton.addEventListener('click', () => this.close());

    header.append(this.title, closeButton);

    this.textarea = document.createElement('textarea');
    this.textarea.readOnly = true;
    this.textarea.spellcheck = false;
    this.textarea.wrap = 'off';
    this.textarea.style.cssText =
      'flex:1;min-height:0;resize:none;border:0;outline:none;background:#0c0f0a;color:#b9d6a7;padding:8px;font:11px monospace;white-space:pre;overflow:auto;';

    this.el.append(header, this.textarea);
    document.body.appendChild(this.el);

    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      this.dragging = true;
      this.dragOffset.x = event.clientX - this.x;
      this.dragOffset.y = event.clientY - this.y;
      header.setPointerCapture?.(event.pointerId);
    });
    header.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.x = event.clientX - this.dragOffset.x;
      this.y = event.clientY - this.dragOffset.y;
      this.el.style.left = `${this.x}px`;
      this.el.style.top = `${this.y}px`;
    });
    header.addEventListener('pointerup', () => {
      this.dragging = false;
    });

    this.setGump(gump);
  }

  buildRaw() {
    const gump = this.gump;
    const parts = [
      `Gump 0x${(gump.id >>> 0).toString(16)}  Sender 0x${(gump.sender >>> 0).toString(16)}`,
      `Position ${gump.x}, ${gump.y}   Size ${gump.width}x${gump.height}   Page ${gump.page}`,
      '',
      'LAYOUT:',
      gump.layout || '',
      '',
      `LINES (${gump.lines.length}):`,
    ];
    if (!gump.lines.length) parts.push('(none)');
    else gump.lines.forEach((line, index) => parts.push(`[${index}] ${line}`));
    return parts.join('\n');
  }

  setGump(gump) {
    this.gump = gump;
    this.title.textContent = `Gump Debug 0x${(gump.id >>> 0).toString(16)}`;
    this.textarea.value = this.buildRaw();
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.el.remove();
    this.onClose?.();
  }
}
const HELP_WIDTH = 660;
const HELP_HEIGHT = 500;
const HELP_HEADER = 54;
const HELP_ROW = 42;

export class HelpWindow {
  constructor(world, commands) {
    this.world = world;
    this.commands = commands || [];
    this.width = Math.min(HELP_WIDTH, Math.max(320, window.innerWidth - 40));
    this.height = Math.min(HELP_HEIGHT, Math.max(240, window.innerHeight - 40));
    this.x = Math.max(20, Math.round((window.innerWidth - this.width) / 2));
    this.y = Math.max(20, Math.round((window.innerHeight - this.height) / 2));
    this.scroll = 0;
    this.hover = null;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  get viewHeight() {
    return Math.max(1, this.height - HELP_HEADER - 14);
  }

  get contentHeight() {
    return this.commands.length * HELP_ROW + 16;
  }

  get maxScroll() {
    return Math.max(0, this.contentHeight - this.viewHeight);
  }

  hit(rect, mx, my) {
    return mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h;
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 26, y: this.y + 8, w: 18, h: 18 };
  }

  rows() {
    return this.commands.map((def, index) => ({
      def,
      x: this.x + 10,
      y: this.y + HELP_HEADER + 8 + index * HELP_ROW - this.scroll,
      w: this.width - 36,
      h: HELP_ROW - 4,
    }));
  }

  defaultInvocation(def) {
    const first = String(def.usage || '')
      .split('|')[0]
      .trim()
      .split(/\s+/)[0];
    return first || `-${def.name}`;
  }

  close() {
    this.world.game.ui.removeWindow('help', 'player');
  }

  onMouseDown(mx, my, button) {
    if (button === 2 || this.hit(this.closeRect(), mx, my)) {
      this.close();
      return true;
    }
    const contentTop = this.y + HELP_HEADER;
    const contentBottom = contentTop + this.viewHeight;
    if (my >= contentTop && my < contentBottom) {
      const row = this.rows().find((rect) => this.hit(rect, mx, my));
      if (row) {
        const input = document.getElementById('chatInput');
        if (input) {
          input.value = `${this.defaultInvocation(row.def)} `;
          input.focus();
        }
        return true;
      }
    }
    this.dragging = true;
    this.dragOffset = { x: mx - this.x, y: my - this.y };
    return true;
  }

  onMouseMove(mx, my) {
    if (this.dragging) {
      this.x = Math.max(0, Math.min(window.innerWidth - this.width, mx - this.dragOffset.x));
      this.y = Math.max(0, Math.min(window.innerHeight - this.height, my - this.dragOffset.y));
      return;
    }
    const contentTop = this.y + HELP_HEADER;
    const contentBottom = contentTop + this.viewHeight;
    this.hover =
      my >= contentTop && my < contentBottom ? this.rows().find((rect) => this.hit(rect, mx, my))?.def.name || null : null;
  }

  onMouseUp() {
    this.dragging = false;
  }

  onWheel(mx, my, delta) {
    if (!this.contains(mx, my)) return false;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + delta));
    return true;
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(20,17,12,0.97)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Commands (${this.commands.length})`, this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.textAlign = 'right';
    ctx.fillText('X', this.x + this.width - 12, this.y + 10);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#7f7253';
    ctx.font = '10px monospace';
    ctx.fillText('Click a command to place it in chat. Scroll for more.', this.x + 12, this.y + 30);

    const contentTop = this.y + HELP_HEADER;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 1, contentTop, this.width - 2, this.viewHeight);
    ctx.clip();
    for (const rect of this.rows()) {
      if (rect.y + rect.h < contentTop || rect.y > contentTop + this.viewHeight) continue;
      const hovered = this.hover === rect.def.name;
      ctx.fillStyle = hovered ? 'rgba(201,176,108,0.16)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = hovered ? '#f0dfa8' : '#c9b06c';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(rect.def.usage, rect.x + 8, rect.y + 6);
      ctx.fillStyle = '#a99a76';
      ctx.font = '11px monospace';
      ctx.fillText(rect.def.description, rect.x + 8, rect.y + 22);
    }
    ctx.restore();

    if (this.maxScroll > 0) {
      const trackX = this.x + this.width - 9;
      const trackY = contentTop;
      const trackH = this.viewHeight;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(trackX, trackY, 5, trackH);
      const thumbH = Math.max(24, (trackH * trackH) / this.contentHeight);
      const thumbY = trackY + ((trackH - thumbH) * this.scroll) / this.maxScroll;
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(trackX, thumbY, 5, thumbH);
    }

    ctx.textBaseline = 'top';
  }
}

function wrap(text, width) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of raw.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width && line) {
        out.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    out.push(line);
  }
  return out;
}
