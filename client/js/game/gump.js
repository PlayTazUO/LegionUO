import { drawUoHtml, color16ToCss, parseUoHtml } from './html.js';

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
  const n = parseInt(String(v).replace('#', ''), 10);
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
    this.canMove = true;
    parse(this);
    this.recalcBounds();
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
      } else if (c.type === 'button') {
        w = Math.max(w, c.x + 32);
        h = Math.max(h, c.y + 32);
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
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  visibleControls() {
    return this.controls.filter((c) => c.page === 0 || c.page === this.page);
  }

  hitControl(mx, my) {
    const lx = mx - this.x;
    const ly = my - this.y;
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
    if (!c || !c.tooltip) return null;
    const text = this.world.game.cliloc(c.tooltip);
    if (!text) return null;
    return { id: `gump:${this.id}:${c.x},${c.y}:${c.tooltip}`, title: text, lines: [] };
  }

  onMouseDown(mx, my, button) {
    const c = this.hitControl(mx, my);
    if (c) {
      if (c.type === 'button') {
        if (c.actionType === 1) {
          this.page = c.param || 0;
        } else {
          this.sendResponse(c.param || 0);
        }
        return true;
      }
      if (c.type === 'checkbox') {
        c.state = !c.state;
        this.switches.set(c.switchId, c.state);
        return true;
      }
      if (c.type === 'radio') {
        for (const other of this.controls) {
          if (other.type === 'radio' && other.group === c.group) other.state = false;
        }
        c.state = true;
        this.switches.set(c.switchId, true);
        return true;
      }
      if (c.type === 'textentry' || c.type === 'textentrylimited') {
        this.world.game.ui.editGumpText(this, c);
        return true;
      }
      if (button === 0 && c.linkRects?.length) {
        const link = c.linkRects.find((rect) => mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h);
        if (link) {
          if (/^https?:\/\//i.test(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer');
          return true;
        }
      }
    }
    if (button === 2) {
      this.sendResponse(0);
      return true;
    }
    if (this.canMove) {
      this.dragging = true;
      this.dragOffset.x = mx - this.x;
      this.dragOffset.y = my - this.y;
    }
    return true;
  }

  onMouseMove(mx, my) {
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
      return true;
    }
    return false;
  }

  onMouseUp() {
    this.dragging = false;
  }

  sendResponse(button) {
    const switches = [];
    for (const [id, state] of this.switches) if (state) switches.push(id >>> 0);
    const entries = [];
    for (const [id, text] of this.entries) entries.push([id, text]);
    this.world.socket.out.gumpResponse(this.world.playerSerial, this.id, button, switches, entries);
    if (button === 0) {
      this.world.removeGump(this.id);
      this.world.game.ui.closeGumpWindow(this.id);
    }
  }

  draw(ctx, now) {
    const assets = this.world.assets;
    const controls = this.visibleControls();
    // Backgrounds and images first, then text and interactive controls.
    for (const c of controls) {
      if (c.type === 'resizepic') this.drawResizePic(ctx, assets, c);
      else if (c.type === 'gumppic' || c.type === 'gumppichued') this.drawGumpPic(ctx, assets, c);
      else if (c.type === 'gumppictiled') this.drawGumpTiled(ctx, assets, c);
      else if (c.type === 'tilepic' || c.type === 'tilepichue') this.drawTilePic(ctx, assets, c);
    }
    for (const c of controls) {
      if (
        c.type === 'text' ||
        c.type === 'croppedtext' ||
        c.type === 'htmlgump' ||
        c.type === 'xmfhtmlgump' ||
        c.type === 'xmfhtmlgumpcolor' ||
        c.type === 'xmfhtmltok'
      ) {
        this.drawText(ctx, c);
      } else if (c.type === 'button') {
        const img = assets.getGump(c.state ? c.down : c.up);
        if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y);
      } else if (c.type === 'checkbox' || c.type === 'radio') {
        const img = assets.getGump(c.state ? c.down : c.up);
        if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y);
      } else if (c.type === 'textentry' || c.type === 'textentrylimited') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(this.x + c.x, this.y + c.y, c.width || 120, c.height || 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(this.x + c.x + 0.5, this.y + c.y + 0.5, (c.width || 120) - 1, (c.height || 20) - 1);
        const text = this.entries.get(c.entryId) || '';
        ctx.fillStyle = '#e8e8e8';
        ctx.font = '13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text.slice(-Math.floor((c.width || 120) / 8)), this.x + c.x + 4, this.y + c.y + 4);
      }
    }
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

  drawGumpTiled(ctx, assets, c) {
    const img = assets.getGump(c.graphic, c.hue || 0);
    if (!img) return;
    const w = c.width || img.width;
    const h = c.height || img.height;
    for (let y = 0; y < h; y += img.height) {
      for (let x = 0; x < w; x += img.width) {
        ctx.drawImage(img, this.x + c.x + x, this.y + c.y + y, Math.min(img.width, w - x), Math.min(img.height, h - y), 0, 0, Math.min(img.width, w - x), Math.min(img.height, h - y));
      }
    }
  }

  drawTilePic(ctx, assets, c) {
    const img = assets.getStatic(c.graphic, c.hue || 0);
    if (img) ctx.drawImage(img, this.x + c.x, this.y + c.y, img.width * 0.75, img.height * 0.75);
  }

  drawText(ctx, c) {
    if (c.type === 'htmlgump' || c.type === 'xmfhtmlgump' || c.type === 'xmfhtmlgumpcolor' || c.type === 'xmfhtmltok') {
      this.drawHtmlText(ctx, c);
      return;
    }

    const game = this.world.game;
    const text = this.resolveText(c.textIndex);
    const hue = c.hue || 0;

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
    });
    c.textHeight = result.height;
  }
}

function parse(gump) {
  const commands = tokenize(gump.layout);
  for (const args of commands) {
    const type = args[0].toLowerCase();
    if (type === 'page') {
      gump.page = int(args[1]);
      continue;
    }
    if (type === 'group' || type === 'endgroup') {
      gump.group++;
      continue;
    }
    const c = new GumpControl(type, args, gump.page, gump.group);
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
        c.up = int(args[3]);
        c.down = int(args[4]);
        c.actionType = int(args[5], 0);
        c.param = int(args[6], 0);
        c.switchId = int(args[7], 0);
        c.tooltip = int(args[8], 0);
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
        c.maxLength = int(args[8], 0);
        c.tooltip = int(args[9], 0);
        if (c.textIndex >= 0 && gump.lines[c.textIndex]) gump.entries.set(c.entryId, gump.lines[c.textIndex]);
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
}
