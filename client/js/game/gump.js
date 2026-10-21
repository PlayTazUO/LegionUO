import { drawUoHtml, color16ToCss, parseUoHtml, hasUoHtmlMarkup } from './html.js';
import { settings } from './settings.js';

function tokenize(layout) {
  const out = [];
  const re = /\{([^}]*)\}/g;
  let match;
  while ((match = re.exec(layout))) {
    const body = match[1].trim();
    if (!body) continue;
    const args = body.split(/[\s,]+/).filter((x) => x.length);
    if (args.length) out.push(args);
  }
  return out;
}

function int(v, fallback = 0) {
  if (v == null) return fallback;
  const raw = String(v).replace('#', '').trim();
  const n = /^0x[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export class GumpControl {
  constructor(type, args, page, group) {
    this.type = type;
    this.args = args;
    this.page = page;
    this.group = group;
    this.x = int(args[1]);
    this.y = int(args[2]);
    this.width = 0;
    this.height = 0;
    this.disabled = false;
    this.state = false;
    this.alpha = 1;
    this.text = '';
    this.tooltip = 0;
  }
}

export class Gump {
  constructor(id, sender, x, y, layout, lines, world) {
    this.id = id >>> 0;
    this.sender = sender >>> 0;
    this.x = x;
    this.y = y;
    this.layout = layout;
    this.lines = lines || [];
    this.world = world;
    this.page = 0;
    this.group = 0;
    this.controls = [];
    this.width = 0;
    this.height = 0;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.switches = new Map();
    this.entries = new Map();
    this.pages = new Set();
    this.canMove = true;
    this.canCloseWithRightClick = true;
    this.canCloseWithEsc = true;
    this.noResize = false;
    this.masterGump = 0;
    this.pendingTooltip = null;
    this.pendingItemProperty = 0;
    this.focusedEntry = null;
    this.scrollDrag = null;
    this.scale = world.getGumpScale?.(this.id) || 1;
    this.parseLayout();
  }

  parseLayout() {
    this.page = 0;
    this.group = 0;
    this.controls = [];
    this.width = 0;
    this.height = 0;
    this.switches.clear();
    this.entries.clear();
    this.pages.clear();
    this.focusedEntry = null;
    this.scrollDrag = null;
    this.pendingTooltip = null;
    this.pendingItemProperty = 0;
    parse(this);
    this.recalcBounds();
    applyCheckerTrans(this);
  }

  setLayout(layout, lines) {
    const switches = new Map(this.switches);
    const entries = new Map(this.entries);
    this.layout = layout;
    this.lines = lines || [];
    this.canMove = true;
    this.canCloseWithRightClick = true;
    this.canCloseWithEsc = true;
    this.noResize = false;
    this.masterGump = 0;
    this.parseLayout();
    for (const control of this.controls) {
      if ((control.type === 'checkbox' || control.type === 'radio') && switches.has(control.switchId)) {
        control.state = !!switches.get(control.switchId);
        if (control.state) this.switches.set(control.switchId, true);
        else this.switches.delete(control.switchId);
      }
      if ((control.type === 'textentry' || control.type === 'textentrylimited') && entries.has(control.entryId)) {
        const text = String(entries.get(control.entryId) ?? '');
        this.entries.set(control.entryId, text);
        control.caret = text.length;
        control.selAnchor = text.length;
      }
    }
  }

  setScale(scale) {
    this.scale = Math.max(0.5, Math.min(2, scale));
    this.world.rememberGumpScale?.(this.id, this.scale);
  }

  resolveText(index) {
    if (index == null) return '';
    if (typeof index === 'string' && index.startsWith('@')) {
      const n = parseInt(index.slice(1), 10);
      return this.lines[n] ?? '';
    }
    const n = int(index, -1);
    if (n >= 0 && n < this.lines.length) return this.lines[n];
    if (n >= 1000000) return this.world.game.cliloc(n) ?? `#${n}`;
    return '';
  }

  recalcBounds() {
    let w = this.width;
    let h = this.height;
    for (const c of this.controls) {
      if (c.page !== 0 && c.page !== this.page) continue;
      if (c.type === 'resizepic') {
        w = Math.max(w, c.x + c.width);
        h = Math.max(h, c.y + c.height);
      } else if (c.type === 'gumppic' || c.type === 'gumppichued') {
        const img = this.world.assets.getGump(c.graphic, c.hue || 0);
        if (img) {
          c.width = img.width;
          c.height = img.height;
        }
        w = Math.max(w, c.x + (c.width || 0));
        h = Math.max(h, c.y + (c.height || 0));
      } else if (c.type === 'tilepic' || c.type === 'tilepichue') {
        const img = this.world.assets.getStatic(c.graphic, c.hue || 0);
        if (img) {
          c.width = Math.round(img.width * 0.75);
          c.height = Math.round(img.height * 0.75);
        }
        w = Math.max(w, c.x + (c.width || 0));
        h = Math.max(h, c.y + (c.height || 0));
      } else if (c.type === 'picinpic' || c.type === 'picinpichued' || c.type === 'picinpicphued') {
        w = Math.max(w, c.x + (c.width || 0));
        h = Math.max(h, c.y + (c.height || 0));
      } else if (c.type === 'maparea') {
        w = Math.max(w, c.x + (c.width || 0));
        h = Math.max(h, c.y + (c.height || 0));
      } else if (c.type === 'button' || c.type === 'buttontileart') {
        w = Math.max(w, c.x + 32);
        h = Math.max(h, c.y + 32);
        if (c.type === 'buttontileart') {
          const art = this.world.assets.getStatic(c.tileGraphic, c.tileHue || 0);
          if (art) {
            w = Math.max(w, c.x + c.tileX + art.width);
            h = Math.max(h, c.y + c.tileY + art.height);
          }
        }
      } else if (c.type === 'checkbox' || c.type === 'radio') {
        w = Math.max(w, c.x + 20);
        h = Math.max(h, c.y + 20);
      } else if (
        c.type === 'text' ||
        c.type === 'croppedtext' ||
        c.type === 'htmlgump' ||
        c.type === 'xmfhtmlgump' ||
        c.type === 'xmfhtmlgumpcolor' ||
        c.type === 'xmfhtmltok' ||
        c.type === 'textentry' ||
        c.type === 'textentrylimited'
      ) {
        w = Math.max(w, c.x + (c.width || 140));
        h = Math.max(h, c.y + (c.height || 20));
      }
    }
    this.width = Math.max(20, Math.round(w));
    this.height = Math.max(20, Math.round(h));
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width * this.scale && my < this.y + this.height * this.scale;
  }

  localPoint(mx, my) {
    return { x: this.x + (mx - this.x) / this.scale, y: this.y + (my - this.y) / this.scale };
  }

  visibleControls() {
    return this.controls.filter((c) => c.page === 0 || c.page === this.page);
  }

  hitControl(mx, my) {
    const point = this.localPoint(mx, my);
    const lx = point.x - this.x;
    const ly = point.y - this.y;
    const list = this.visibleControls();
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      const w = c.width || 40;
      const h = c.height || 24;
      if (c.type === 'resizepic') continue;
      if (lx >= c.x && ly >= c.y && lx < c.x + w && ly < c.y + h) return c;
    }
    return null;
  }

  tooltipAt(mx, my) {
    const c = this.hitControl(mx, my);
    if (!c) return null;
    const key = `${this.id}:${c.x},${c.y}`;
    if (c.itemProperty) {
      const item = this.world.getItem(c.itemProperty);
      return {
        id: `gump:${key}:${c.itemProperty}`,
        serial: c.itemProperty,
        title: item?.name || '',
        lines: [],
      };
    }
    let title = '';
    if (c.tooltipCliloc) title = this.world.game.cliloc(c.tooltipCliloc, c.tooltipArgs || '') || '';
    else if (c.tooltip) title = this.world.game.cliloc(c.tooltip) || '';
    if (!title && !c.tooltipLines?.length) return null;
    return {
      id: `gump:${key}:${c.tooltipCliloc || c.tooltip || title}`,
      title,
      lines: c.tooltipLines ? [...c.tooltipLines] : [],
    };
  }

  onMouseDown(screenX, screenY, button) {
    const point = this.localPoint(screenX, screenY);
    let mx = point.x;
    let my = point.y;
    const c = this.hitControl(screenX, screenY);
    const ui = this.world.game.ui;
    if (button === 2) {
      if (this.canCloseWithRightClick) this.sendResponse(0);
      return true;
    }
    if (c) {
      if (button === 0 && this.isScrollbarHit(c, mx, my)) {
        ui.clearGumpFocus();
        this.beginScrollbarDrag(c, my);
        return true;
      }
      if (c.type === 'button' || c.type === 'buttontileart') {
        ui.clearGumpFocus();
        if (c.actionType === 0) {
          this.page = c.pageParam;
        } else {
          this.sendResponse(c.hasButtonId ? c.buttonId : 0);
        }
        return true;
      }
      if (c.type === 'checkbox') {
        ui.clearGumpFocus();
        c.state = !c.state;
        this.switches.set(c.switchId, c.state);
        return true;
      }
      if (c.type === 'radio') {
        ui.clearGumpFocus();
        for (const other of this.controls) {
          if (other.type === 'radio' && other.group === c.group) other.state = false;
        }
        c.state = true;
        this.switches.set(c.switchId, true);
        return true;
      }
      if (c.type === 'textentry' || c.type === 'textentrylimited') {
        this.focusEntry(c, mx);
        return true;
      }
      if (c.type === 'htmlgump' || c.type === 'xmfhtmlgump' || c.type === 'xmfhtmlgumpcolor' || c.type === 'xmfhtmltok') {
        ui.clearGumpFocus();
        if (button === 0 && c.linkRects?.length) {
          const link = c.linkRects.find((rect) => mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h);
          if (link) {
            if (/^https?:\/\//i.test(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer');
            return true;
          }
        }
      }
      if (button === 0 && c.linkRects?.length) {
        const link = c.linkRects.find((rect) => mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h);
        if (link) {
          ui.clearGumpFocus();
          if (/^https?:\/\//i.test(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer');
          return true;
        }
      }
    }
    ui.clearGumpFocus();
    if (this.canMove) {
      this.dragging = true;
      this.dragOffset.x = mx - this.x;
      this.dragOffset.y = my - this.y;
    }
    return true;
  }

  onMouseMove(screenX, screenY) {
    const point = this.localPoint(screenX, screenY);
    let mx = point.x;
    let my = point.y;
    if (this.scrollDrag) {
      this.updateScrollbarDrag(my);
      return true;
    }
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
      return true;
    }
    return false;
  }

  onMouseUp() {
    if (this.dragging) this.world.rememberGumpPosition(this.id, this.x, this.y);
    this.dragging = false;
    this.scrollDrag = null;
  }

  onWheel(screenX, screenY, delta, event) {
    if (event?.ctrlKey) {
      this.setScale(this.scale + (delta > 0 ? -0.1 : 0.1));
      return true;
    }
    const c = this.hitControl(screenX, screenY);
    if (!c || !c.scrollbar || !c.contentHeight) return false;
    const view = this.htmlInnerHeight(c);
    const max = Math.max(0, c.contentHeight - view);
    if (max <= 0) return false;
    c.scrollY = Math.max(0, Math.min(max, (c.scrollY || 0) + (delta > 0 ? 48 : -48)));
    return true;
  }

  htmlScrollbarRect(c) {
    if (!c.scrollbar) return null;
    const width = c.width || 0;
    const height = c.height || 0;
    return { x: this.x + c.x + width - 12, y: this.y + c.y, w: 12, h: height };
  }

  htmlInnerHeight(c) {
    return Math.max(1, (c.height || 0) - (c.background ? 8 : 0));
  }

  isScrollbarHit(c, mx, my) {
    const track = this.htmlScrollbarRect(c);
    return !!track && mx >= track.x && mx < track.x + track.w && my >= track.y && my < track.y + track.h;
  }

  beginScrollbarDrag(c, my) {
    const track = this.htmlScrollbarRect(c);
    if (!track) return;
    const view = this.htmlInnerHeight(c);
    const max = Math.max(0, (c.contentHeight || 0) - view);
    if (max <= 0) return;
    const thumb = Math.max(20, Math.round(track.h * Math.min(1, view / c.contentHeight)));
    const thumbY = track.y + (track.h - thumb) * ((c.scrollY || 0) / max);
    const inside = my >= thumbY && my < thumbY + thumb;
    const offset = inside ? my - thumbY : thumb / 2;
    const travel = Math.max(1, track.h - thumb);
    const ratio = Math.max(0, Math.min(1, (my - offset - track.y) / travel));
    c.scrollY = Math.round(ratio * max);
    this.scrollDrag = { control: c, offset };
  }

  updateScrollbarDrag(my) {
    const { control: c, offset } = this.scrollDrag;
    const track = this.htmlScrollbarRect(c);
    if (!track) return;
    const view = this.htmlInnerHeight(c);
    const max = Math.max(0, (c.contentHeight || 0) - view);
    if (max <= 0) return;
    const thumb = Math.max(20, Math.round(track.h * Math.min(1, view / c.contentHeight)));
    const travel = Math.max(1, track.h - thumb);
    const ratio = Math.max(0, Math.min(1, (my - offset - track.y) / travel));
    c.scrollY = Math.round(ratio * max);
  }

  focusEntry(control, mx) {
    this.focusedEntry = control;
    control.caret = Math.max(0, Math.min(control.caret ?? control.text?.length ?? 0, (this.entries.get(control.entryId) || '').length));
    control.selAnchor = control.caret;
    control.blinkStart = performance.now();
    const text = this.entries.get(control.entryId) || '';
    control.caret = this.caretFromX(control, mx, text);
    control.selAnchor = control.caret;
    this.world.game.ui.setGumpFocus(this, control);
  }

  blurEntry() {
    if (!this.focusedEntry) return false;
    this.focusedEntry = null;
    return true;
  }

  entryControls() {
    return this.visibleControls().filter((c) => c.type === 'textentry' || c.type === 'textentrylimited');
  }

  focusNextEntry(backwards = false) {
    const entries = this.entryControls();
    if (!entries.length) return false;
    let index = entries.indexOf(this.focusedEntry);
    if (index < 0) index = backwards ? 0 : -1;
    const next = entries[(index + (backwards ? entries.length - 1 : 1)) % entries.length];
    this.focusEntry(next, this.x + next.x + 4);
    return true;
  }

  caretFromX(control, mx, text) {
    const left = this.x + control.x + 4 - (control.viewOffset || 0);
    const x = mx - left;
    const ctx = this.world.game.renderer?.canvas?.getContext?.('2d');
    let width = 0;
    if (!ctx) return Math.max(0, Math.min(text.length, Math.round(x / 8)));
    ctx.save();
    ctx.font = '13px monospace';
    for (let i = 0; i < text.length; i++) {
      const w = ctx.measureText(text[i]).width;
      if (width + w / 2 > x) {
        ctx.restore();
        return i;
      }
      width += w;
    }
    ctx.restore();
    return text.length;
  }

  textWidth(text) {
    const ctx = this.world.game.renderer?.canvas?.getContext?.('2d');
    if (!ctx) return text.length * 8;
    ctx.save();
    ctx.font = '13px monospace';
    const width = ctx.measureText(text).width;
    ctx.restore();
    return width;
  }

  onKeyDown(e) {
    const control = this.focusedEntry;
    if (!control) return false;
    let text = this.entries.get(control.entryId) || '';
    const maxLength = control.maxLength || 255;
    let caret = Math.max(0, Math.min(control.caret ?? text.length, text.length));
    let anchor = Math.max(0, Math.min(control.selAnchor ?? caret, text.length));
    const changed = () => {
      this.entries.set(control.entryId, text);
      control.caret = caret;
      control.selAnchor = anchor;
      control.blinkStart = performance.now();
    };
    const replaceSelection = (value) => {
      const start = Math.min(caret, anchor);
      const end = Math.max(caret, anchor);
      let next = text.slice(0, start) + value + text.slice(end);
      if (next.length > maxLength) next = next.slice(0, maxLength);
      caret = Math.min(start + value.length, next.length);
      anchor = caret;
      text = next;
    };

    if (e.key === 'Escape') {
      this.world.game.ui.clearGumpFocus();
      return true;
    }
    if (e.key === 'Tab') {
      this.focusNextEntry(e.shiftKey);
      return true;
    }
    if (e.key === 'Enter') {
      this.world.game.ui.clearGumpFocus();
      return true;
    }
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'a') {
        control.selAnchor = 0;
        control.caret = text.length;
        control.blinkStart = performance.now();
        return true;
      }
      if (key === 'c' || key === 'x') {
        const start = Math.min(caret, anchor);
        const end = Math.max(caret, anchor);
        if (end > start) {
          navigator.clipboard?.writeText(text.slice(start, end)).catch(() => {});
          if (key === 'x') replaceSelection('');
        }
        return true;
      }
      if (key === 'v') {
        navigator.clipboard
          ?.readText()
          .then((value) => {
            if (!value || this.focusedEntry !== control) return;
            replaceSelection(value.replace(/[\r\n]+/g, ' '));
            this.entries.set(control.entryId, text);
            control.caret = caret;
            control.selAnchor = anchor;
            control.blinkStart = performance.now();
          })
          .catch(() => {});
        return true;
      }
      return false;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (e.key === 'Home' || e.key === 'ArrowUp') caret = 0;
      else if (e.key === 'End' || e.key === 'ArrowDown') caret = text.length;
      else caret += e.key === 'ArrowLeft' ? -1 : 1;
      caret = Math.max(0, Math.min(text.length, caret));
      if (!e.shiftKey) anchor = caret;
      control.caret = caret;
      control.selAnchor = anchor;
      control.blinkStart = performance.now();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (caret !== anchor) {
        replaceSelection('');
      } else if (e.key === 'Backspace' && caret > 0) {
        text = text.slice(0, caret - 1) + text.slice(caret);
        caret--;
        anchor = caret;
      } else if (e.key === 'Delete' && caret < text.length) {
        text = text.slice(0, caret) + text.slice(caret + 1);
        anchor = caret;
      }
      changed();
      return true;
    }
    if (e.key.length > 0 && e.key.length <= 2 && !e.altKey && !e.isComposing) {
      replaceSelection(e.key);
      changed();
      return true;
    }
    return false;
  }

  insertText(value) {
    const control = this.focusedEntry;
    if (!control || !value) return false;
    const text = this.entries.get(control.entryId) || '';
    const maxLength = control.maxLength || 255;
    const caret = Math.max(0, Math.min(control.caret ?? text.length, text.length));
    const anchor = Math.max(0, Math.min(control.selAnchor ?? caret, text.length));
    const start = Math.min(caret, anchor);
    const end = Math.max(caret, anchor);
    const next = (text.slice(0, start) + value + text.slice(end)).slice(0, maxLength);
    this.entries.set(control.entryId, next);
    control.caret = Math.min(start + value.length, next.length);
    control.selAnchor = control.caret;
    control.blinkStart = performance.now();
    return true;
  }

  onBlur() {
    this.focusedEntry = null;
  }

  close() {
    if (!this.canCloseWithEsc) return;
    this.sendResponse(0);
  }

  sendResponse(button) {
    const switches = [];
    for (const [id, state] of this.switches) if (state) switches.push(id >>> 0);
    const entries = [];
    for (const [id, text] of this.entries) entries.push([id, text]);
    this.world.socket.out.gumpResponse(this.sender, this.id, button, switches, entries);
    this.world.game.ui.closeGumpAndDependents(this);
  }

  draw(ctx, now) {
    const assets = this.world.assets;
    const controls = this.visibleControls();
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x, -this.y);
    ctx.globalAlpha = 1;
    // Backgrounds and images first, then text and interactive controls.
    for (const c of controls) {
      ctx.globalAlpha = c.alpha ?? 1;
      if (c.type === 'resizepic') this.drawResizePic(ctx, assets, c);
      else if (c.type === 'gumppic' || c.type === 'gumppichued') this.drawGumpPic(ctx, assets, c);
      else if (c.type === 'gumppictiled') this.drawGumpTiled(ctx, assets, c);
      else if (c.type === 'tilepic' || c.type === 'tilepichue') this.drawTilePic(ctx, assets, c);
      else if (c.type === 'picinpic' || c.type === 'picinpichued' || c.type === 'picinpicphued') {
        this.drawGumpInPic(ctx, assets, c);
      } else if (c.type === 'checkertrans') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(this.x + c.x, this.y + c.y, c.width, c.height);
      } else if (c.type === 'maparea') {
        this.drawMapArea(ctx, c);
      }
    }
    ctx.globalAlpha = 1;
    for (const c of controls) {
      ctx.globalAlpha = c.alpha ?? 1;
      if (
        c.type === 'text' ||
        c.type === 'croppedtext' ||
        c.type === 'htmlgump' ||
        c.type === 'xmfhtmlgump' ||
        c.type === 'xmfhtmlgumpcolor' ||
        c.type === 'xmfhtmltok'
      ) {
        this.drawText(ctx, c);
      } else if (c.type === 'button' || c.type === 'buttontileart') {
        const img = assets.getGump(c.state ? c.down : c.up);
        if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y);
        if (c.type === 'buttontileart') {
          const art = assets.getStatic(c.tileGraphic, c.tileHue || 0);
          if (art) ctx.drawImage(art, this.x + c.x + c.tileX, this.y + c.y + c.tileY);
        }
      } else if (c.type === 'checkbox' || c.type === 'radio') {
        const img = assets.getGump(c.state ? c.down : c.up);
        if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y);
      } else if (c.type === 'textentry' || c.type === 'textentrylimited') {
        this.drawTextEntry(ctx, c, now);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawMapArea(ctx, c) {
    const x0 = Math.min(c.mapX, c.mapEndX);
    const y0 = Math.min(c.mapY, c.mapEndY);
    const x1 = Math.max(c.mapX, c.mapEndX);
    const y1 = Math.max(c.mapY, c.mapEndY);
    const width = Math.max(1, c.width);
    const height = Math.max(1, c.height);
    const key = `gumpmap|${c.mapIndex}|${x0}|${y0}|${x1}|${y1}|${width}|${height}`;
    const img = this.world.assets.image(
      key,
      this.world.assets.url(`/api/mapimage?facet=${c.mapIndex}&x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}&w=${width}&h=${height}`)
    );
    if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y, width, height);
  }

  drawResizePic(ctx, assets, c) {
    const ids = [c.graphic, c.graphic + 1, c.graphic + 2, c.graphic + 3, c.graphic + 5, c.graphic + 6, c.graphic + 7, c.graphic + 8, c.graphic + 4];
    const imgs = ids.map((id) => assets.getGump(id));
    const [tl, top, tr, left, right, bl, bottom, br, center] = imgs;
    const x = this.x + c.x;
    const y = this.y + c.y;
    const w = c.width;
    const h = c.height;
    const tw = tl?.width || 0;
    const th = tl?.height || 0;
    const rw = tr?.width || 0;
    const rh = tr?.height || 0;
    const bw = bl?.width || 0;
    const bh = bl?.height || 0;
    if (center) ctx.drawImage(center, x + tw, y + th, Math.max(0, w - tw - rw), Math.max(0, h - th - bh));
    if (top) ctx.drawImage(top, x + tw, y, Math.max(0, w - tw - rw), top.height);
    if (left) ctx.drawImage(left, x, y + th, left.width, Math.max(0, h - th - bh));
    if (right) ctx.drawImage(right, x + w - right.width, y + th, right.width, Math.max(0, h - th - bh));
    if (bottom) ctx.drawImage(bottom, x + bw, y + h - bottom.height, Math.max(0, w - bw - (br?.width || 0)), bottom.height);
    if (tl) ctx.drawImage(tl, x, y);
    if (tr) ctx.drawImage(tr, x + w - rw, y);
    if (bl) ctx.drawImage(bl, x, y + h - bh);
    if (br) ctx.drawImage(br, x + w - br.width, y + h - br.height);
  }

  drawGumpPic(ctx, assets, c) {
    const img = assets.getGump(c.graphic, c.hue || 0);
    if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y);
  }

  drawGumpInPic(ctx, assets, c) {
    const img = assets.getGump(c.graphic, c.hue || 0);
    if (!img) return;
    ctx.drawImage(
      img,
      c.srcX || 0,
      c.srcY || 0,
      c.width || img.width,
      c.height || img.height,
      this.x + c.x,
      this.y + c.y,
      c.width || img.width,
      c.height || img.height
    );
  }

  drawGumpTiled(ctx, assets, c) {
    const img = assets.getGump(c.graphic, c.hue || 0);
    if (!img) return;
    const w = c.width || img.width;
    const h = c.height || img.height;
    for (let y = 0; y < h; y += img.height) {
      for (let x = 0; x < w; x += img.width) {
        const tw = Math.min(img.width, w - x);
        const th = Math.min(img.height, h - y);
        ctx.drawImage(img, 0, 0, tw, th, this.x + c.x + x, this.y + c.y + y, tw, th);
      }
    }
  }

  drawTilePic(ctx, assets, c) {
    const img = assets.getStatic(c.graphic, c.hue || 0);
    if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y, img.width * 0.75, img.height * 0.75);
  }

  drawTextEntry(ctx, c, now) {
    const w = c.width || 120;
    const h = c.height || 20;
    const x = this.x + c.x;
    const y = this.y + c.y;
    const focused = this.focusedEntry === c;
    const text = this.entries.get(c.entryId) || '';
    const pad = 4;
    const innerWidth = Math.max(1, w - pad * 2 - 2);
    const caret = Math.max(0, Math.min(c.caret ?? text.length, text.length));
    const caretOffset = this.textWidth(text.slice(0, caret));
    let view = c.viewOffset || 0;
    if (caretOffset - view > innerWidth) view = caretOffset - innerWidth;
    if (caretOffset - view < 0) view = caretOffset;
    c.viewOffset = Math.max(0, view);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = focused ? 'rgba(255,226,150,0.75)' : 'rgba(255,255,255,0.25)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + pad, y + 1, innerWidth + 2, h - 2);
    ctx.clip();
    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const textY = y + Math.max(2, (h - 13) / 2);

    if (focused) {
      const anchor = Math.max(0, Math.min(c.selAnchor ?? caret, text.length));
      const start = Math.min(caret, anchor);
      const end = Math.max(caret, anchor);
      if (end > start) {
        const sx = this.textWidth(text.slice(0, start)) - view;
        const ex = this.textWidth(text.slice(0, end)) - view;
        ctx.fillStyle = 'rgba(110,150,210,0.55)';
        ctx.fillRect(x + pad + sx, y + 2, ex - sx, h - 4);
      }
    }

    ctx.fillStyle = focused ? '#f4f0df' : '#e8e8e8';
    ctx.fillText(text, x + pad - view, textY);

    if (focused && Math.floor((now - (c.blinkStart || 0)) / 500) % 2 === 0) {
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(x + pad + caretOffset - view, y + 3, 1, h - 6);
    }
    ctx.restore();
  }

  drawText(ctx, c) {
    if (c.type === 'htmlgump' || c.type === 'xmfhtmlgump' || c.type === 'xmfhtmlgumpcolor' || c.type === 'xmfhtmltok') {
      this.drawHtmlText(ctx, c);
      return;
    }

    const game = this.world.game;
    const text = this.resolveText(c.textIndex);
    const hue = c.hue || 0;

    if (!hasUoHtmlMarkup(text) && this.drawBitmapText(ctx, c, text, hue)) return;

    const color = game.hueColor(hue);
    const key = `${color}\u0000${text}`;
    if (c.htmlKey !== key) {
      c.htmlKey = key;
      c.htmlParsed = parseUoHtml(text, { color, size: 13 });
    }
    if (!c.linkRects) c.linkRects = [];
    c.linkRects.length = 0;
    drawUoHtml(ctx, c.htmlParsed, {
      x: this.x + c.x,
      y: this.y + c.y,
      width: c.type === 'croppedtext' ? c.width || 100 : 0,
      height: c.type === 'croppedtext' ? c.height || 20 : Infinity,
      defaultColor: color,
      fontSize: 13,
      fontFamily: 'monospace',
      clip: c.type === 'croppedtext',
      links: c.linkRects,
    });
  }

  drawBitmapText(ctx, c, text, hue) {
    const font = this.world.assets.getFont(settings.get('gumpFont') || 3, hue);
    if (!font?.img || !font.meta?.glyphs) return false;
    const glyphs = font.meta.glyphs;
    const maxWidth = c.type === 'croppedtext' ? c.width || 100 : Infinity;
    const maxHeight = c.type === 'croppedtext' ? c.height || 20 : Infinity;
    ctx.save();
    if (c.type === 'croppedtext') {
      ctx.beginPath();
      ctx.rect(this.x + c.x, this.y + c.y, maxWidth, maxHeight);
      ctx.clip();
    }
    let x = this.x + c.x;
    let y = this.y + c.y;
    for (const char of String(text)) {
      if (char === '\n') {
        x = this.x + c.x;
        y += font.meta.height || 14;
        continue;
      }
      const index = char.charCodeAt(0) - 32;
      if (index < 0) continue;
      const glyph = glyphs[index];
      if (!glyph) continue;
      if (glyph.w > 0 && glyph.h > 0) {
        ctx.drawImage(font.img, glyph.x, glyph.y, glyph.w, glyph.h, x, y, glyph.w, glyph.h);
      }
      x += glyph.advance || glyph.w || 0;
      if (x - (this.x + c.x) > maxWidth) break;
    }
    ctx.restore();
    return true;
  }

  drawHtmlText(ctx, c) {
    const width = c.width || this.width;
    const height = c.height || this.height;
    const offset = c.background ? 4 : 0;
    const innerWidth = Math.max(1, width - offset * 2 - (c.scrollbar ? 14 : 0));
    const innerHeight = Math.max(1, height - offset * 2);
    const defaultColor = c.hue
      ? color16ToCss(c.hue) || '#010101'
      : !c.background && c.scrollbar
        ? '#ffffff'
        : '#010101';

    let text = '';
    if (c.type === 'htmlgump') {
      text = this.lines[c.textIndex] ?? '';
    } else if (c.type === 'xmfhtmltok') {
      text = this.world.game.cliloc(c.textIndex, c.textArgs || '') ?? '';
    } else {
      text = this.world.game.cliloc(c.textIndex) ?? '';
    }

    const htmlKey = `${defaultColor}\u0000${text}`;
    if (c.htmlKey !== htmlKey) {
      c.htmlKey = htmlKey;
      c.htmlParsed = parseUoHtml(text, { color: defaultColor, size: 13 });
    }

    if (c.background) {
      this.drawResizePic(ctx, this.world.assets, {
        graphic: 0x2486,
        x: c.x,
        y: c.y,
        width: width - (c.scrollbar ? 16 : 0),
        height,
      });
    } else if (c.htmlParsed.background) {
      ctx.fillStyle = c.htmlParsed.background;
      ctx.fillRect(this.x + c.x, this.y + c.y, width, height);
    }

    if (!c.linkRects) c.linkRects = [];
    c.linkRects.length = 0;
    const result = drawUoHtml(ctx, c.htmlParsed, {
      x: this.x + c.x + offset,
      y: this.y + c.y + offset,
      width: innerWidth,
      height: innerHeight,
      defaultColor,
      fontSize: 13,
      fontFamily: 'monospace',
      links: c.linkRects,
      scrollY: c.scrollY || 0,
    });
    c.textHeight = result.height;
    c.contentHeight = result.height;
    const maxScroll = Math.max(0, result.height - innerHeight);
    c.scrollY = Math.max(0, Math.min(maxScroll, c.scrollY || 0));
    if (c.scrollbar && maxScroll > 0) this.drawScrollbar(ctx, c, innerHeight);
  }

  drawScrollbar(ctx, c, viewHeight) {
    const track = this.htmlScrollbarRect(c);
    if (!track) return;
    const content = Math.max(1, c.contentHeight || 1);
    const thumb = Math.max(20, Math.round(track.h * Math.min(1, viewHeight / content)));
    const max = Math.max(1, content - viewHeight);
    const thumbY = track.y + (track.h - thumb) * ((c.scrollY || 0) / max);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(track.x, track.y, track.w, track.h);
    ctx.strokeStyle = 'rgba(200,180,125,0.22)';
    ctx.strokeRect(track.x + 0.5, track.y + 0.5, track.w - 1, track.h - 1);
    ctx.fillStyle = 'rgba(198,176,126,0.55)';
    ctx.fillRect(track.x + 2, thumbY + 1, track.w - 4, Math.max(4, thumb - 2));
  }
}

function applyCheckerTrans(gump) {
  for (const trans of gump.controls) {
    if (trans.type !== 'checkertrans') continue;
    const x2 = trans.x + trans.width;
    const y2 = trans.y + trans.height;
    for (const c of gump.controls) {
      if (c === trans) continue;
      if (c.page !== 0 && c.page !== trans.page) continue;
      const w = c.width || (c.type === 'text' ? 140 : 40);
      const h = c.height || 20;
      if (trans.x < c.x + w && c.x < x2 && trans.y < c.y + h && c.y < y2) c.alpha = 0.5;
    }
  }
}

function parse(gump) {
  const commands = tokenize(gump.layout);
  let page = 0;
  for (const args of commands) {
    const type = args[0].toLowerCase();
    if (type === 'page') {
      page = int(args[1]);
      gump.pages.add(page);
      continue;
    }
    if (type === 'group' || type === 'endgroup') {
      gump.group++;
      continue;
    }
    if (type === 'nomove') {
      gump.canMove = false;
      continue;
    }
    if (type === 'noclose') {
      gump.canCloseWithRightClick = false;
      continue;
    }
    if (type === 'nodispose') {
      gump.canCloseWithEsc = false;
      continue;
    }
    if (type === 'noresize') {
      gump.noResize = true;
      continue;
    }
    if (type === 'mastergump') {
      gump.masterGump = int(args[1], 0) >>> 0;
      continue;
    }
    if (type === 'tooltip') {
      const tooltip = {
        cliloc: int(args[1], 0),
        args: args.slice(2).join('\t'),
      };
      const last = gump.controls[gump.controls.length - 1];
      if (last) {
        last.tooltipCliloc = tooltip.cliloc;
        last.tooltipArgs = tooltip.args;
      } else {
        gump.pendingTooltip = tooltip;
      }
      continue;
    }
    if (type === 'itemproperty') {
      const serial = int(args[1], 0) >>> 0;
      const last = gump.controls[gump.controls.length - 1];
      if (last) last.itemProperty = serial;
      else gump.pendingItemProperty = serial;
      continue;
    }
    const c = new GumpControl(type, args, page, gump.group);
    if (gump.pendingTooltip) {
      c.tooltipCliloc = gump.pendingTooltip.cliloc;
      c.tooltipArgs = gump.pendingTooltip.args;
      gump.pendingTooltip = null;
    }
    if (gump.pendingItemProperty) {
      c.itemProperty = gump.pendingItemProperty;
      gump.pendingItemProperty = 0;
    }
    switch (type) {
      case 'resizepic':
        c.graphic = int(args[3]);
        c.width = int(args[4]);
        c.height = int(args[5]);
        break;
      case 'gumppic':
      case 'tilepicasgumppic':
        c.graphic = int(args[3]);
        c.hue = int(args[4], 0);
        c.tooltip = int(args[5], 0);
        break;
      case 'gumppichued':
      case 'gumppicphued':
        c.graphic = int(args[3]);
        c.hue = int(args[4], 0);
        c.tooltip = int(args[5], 0);
        break;
      case 'gumppictiled':
        c.width = int(args[3]);
        c.height = int(args[4]);
        c.graphic = int(args[5]);
        break;
      case 'picinpic':
      case 'picinpichued':
      case 'picinpicphued':
        c.graphic = int(args[3]);
        c.srcX = int(args[4]);
        c.srcY = int(args[5]);
        c.width = int(args[6]);
        c.height = int(args[7]);
        c.tooltip = int(args[8], 0);
        break;
      case 'maparea':
        c.width = int(args[3]);
        c.height = int(args[4]);
        c.mapIndex = int(args[5], 0);
        c.mapX = int(args[6], 0);
        c.mapY = int(args[7], 0);
        c.mapEndX = int(args[8], 0);
        c.mapEndY = int(args[9], 0);
        break;
      case 'tilepic':
        c.graphic = int(args[3]);
        c.hue = int(args[4], 0);
        c.tooltip = int(args[5], 0);
        break;
      case 'tilepichue':
        c.graphic = int(args[3]);
        c.hue = int(args[4], 0);
        c.tooltip = int(args[5], 0);
        break;
      case 'text':
        c.hue = int(args[3]);
        c.textIndex = args[4];
        c.tooltip = int(args[5], 0);
        break;
      case 'croppedtext':
        c.width = int(args[3]);
        c.height = int(args[4]);
        c.hue = int(args[5]);
        c.textIndex = args[6];
        c.tooltip = int(args[7], 0);
        break;
      case 'htmlgump':
      case 'xmfhtmlgump':
      case 'xmfhtmlgumpcolor':
        c.width = int(args[3]);
        c.height = int(args[4]);
        c.textIndex = int(args[5]);
        c.background = int(args[6], 0) === 1;
        c.scrollbar = int(args[7], 0) !== 0;
        if (type === 'xmfhtmlgumpcolor') c.hue = int(args[8], 0);
        break;
      case 'xmfhtmltok':
        c.width = int(args[3]);
        c.height = int(args[4]);
        c.background = int(args[5], 0) === 1;
        c.scrollbar = int(args[6], 0) !== 0;
        c.hue = int(args[7], 0);
        c.textIndex = int(args[8]);
        c.textArgs = args.slice(9).join('\t');
        break;
      case 'button':
      case 'buttontileart':
        c.up = int(args[3]);
        c.down = int(args[4]);
        c.actionType = int(args[5], 0);
        c.pageParam = int(args[6], 0);
        c.hasButtonId = args.length >= 8;
        c.buttonId = int(args[7], 0);
        if (type === 'buttontileart') {
          c.tileGraphic = int(args[8]);
          c.tileHue = int(args[9], 0);
          c.tileX = int(args[10], 0);
          c.tileY = int(args[11], 0);
        } else {
          c.tooltip = int(args[8], 0);
        }
        c.width = 32;
        c.height = 32;
        break;
      case 'checkbox':
      case 'radio':
        c.up = int(args[3]);
        c.down = int(args[4]);
        c.state = int(args[5], 0) !== 0;
        c.switchId = int(args[6], 0);
        c.tooltip = int(args[7], 0);
        c.width = 20;
        c.height = 20;
        if (c.state) gump.switches.set(c.switchId, true);
        break;
      case 'textentry':
      case 'textentrylimited':
        c.width = int(args[3]);
        c.height = int(args[4]);
        c.hue = int(args[5]);
        c.entryId = int(args[6]);
        c.textIndex = int(args[7], -1);
        c.maxLength = type === 'textentrylimited' ? int(args[8], 255) : 255;
        c.tooltip = int(args[9], 0);
        c.caret = 0;
        c.selAnchor = 0;
        c.viewOffset = 0;
        c.blinkStart = 0;
        if (c.textIndex >= 0 && gump.lines[c.textIndex]) {
          gump.entries.set(c.entryId, gump.lines[c.textIndex]);
          c.caret = gump.lines[c.textIndex].length;
          c.selAnchor = c.caret;
        }
        break;
      case 'checkertrans':
        c.width = int(args[3]);
        c.height = int(args[4]);
        break;
      default:
        break;
    }
    gump.controls.push(c);
  }
  gump.page = gump.pages.has(1) ? 1 : 0;
}
