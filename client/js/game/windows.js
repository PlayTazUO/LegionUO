import { Layer } from './entity.js';

export class ContainerWindow {
  constructor(world, serial, gumpId) {
    this.world = world;
    this.serial = serial >>> 0;
    this.gumpId = gumpId;
    this.x = Math.max(20, window.innerWidth - 260 - Math.random() * 120);
    this.y = 60 + Math.random() * 60;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.scroll = 0;
  }

  get item() {
    return this.world.getItem(this.serial);
  }

  get items() {
    const parent = this.world.get(this.serial);
    if (!parent) return [];
    return [...parent.items.values()]
      .filter((it) => it.layer === Layer.Invalid && it !== this.world.player)
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  background() {
    return this.world.assets.getGump(this.gumpId);
  }

  get width() {
    return this.background()?.width || 240;
  }

  get height() {
    return this.background()?.height || 220;
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
    const items = this.items;
    const cols = Math.max(1, Math.floor((this.width - 20) / 46));
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ix = 12 + col * 46;
      const iy = 30 + row * 46 + this.scroll;
      if (lx >= ix && ly >= iy && lx < ix + 44 && ly < iy + 44) {
        const item = items[i];
        if (button === 0 && !this.world.held) {
          this.world.held = item;
          this.world.socket.out.pickup(item.serial, item.amount);
        }
        return true;
      }
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseUp(mx, my) {
    this.dragging = false;
    if (this.world.held && this.contains(mx, my)) {
      const item = this.world.held;
      this.world.held = null;
      this.world.socket.out.drop(item.serial, 0, 0, 0, 0, this.serial);
    }
  }

  onMouseMove(mx, my) {
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
    }
  }

  onDoubleClick(mx, my) {
    const lx = mx - this.x;
    const ly = my - this.y;
    const items = this.items;
    const cols = Math.max(1, Math.floor((this.width - 20) / 46));
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ix = 12 + col * 46;
      const iy = 30 + row * 46 + this.scroll;
      if (lx >= ix && ly >= iy && lx < ix + 44 && ly < iy + 44) {
        this.world.socket.out.doubleClick(items[i].serial);
        return;
      }
    }
  }

  close() {
    this.world.game.ui.closeContainer(this.serial);
  }

  draw(ctx, now) {
    const bg = this.background();
    if (bg) {
      ctx.drawImage(bg, this.x, this.y);
    } else {
      ctx.fillStyle = 'rgba(24,20,14,0.96)';
      ctx.fillRect(this.x, this.y, this.width, this.height);
      ctx.strokeStyle = '#8d7a52';
      ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    }
    ctx.fillStyle = '#e8d7a8';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.item?.name || `Container 0x${this.serial.toString(16)}`, this.x + 10, this.y + 8);

    const items = this.items;
    const cols = Math.max(1, Math.floor((this.width - 20) / 46));
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 6, this.y + 24, this.width - 12, this.height - 92);
    ctx.clip();
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ix = this.x + 12 + col * 46;
      const iy = this.y + 30 + row * 46 + this.scroll;
      const item = items[i];
      const img = this.world.assets.getStatic(item.graphic, item.hue);
      if (img) {
        const scale = Math.min(1, 40 / Math.max(img.width, img.height));
        ctx.drawImage(img, ix + (44 - img.width * scale) / 2, iy + (44 - img.height * scale) / 2, img.width * scale, img.height * scale);
      }
      if (item.amount > 1) {
        ctx.fillStyle = '#ffe08a';
        ctx.font = '11px monospace';
        ctx.fillText(String(item.amount), ix + 26, iy + 30);
      }
    }
    ctx.restore();

    ctx.fillStyle = '#d6c18b';
    ctx.font = '12px monospace';
    ctx.fillText('Double-click to use. Drag to move.', this.x + 10, this.y + this.height - 22);
  }
}

export class PaperdollWindow {
  constructor(world, mobile) {
    this.world = world;
    this.mobile = mobile;
    this.x = 140;
    this.y = 100;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.width = 260;
    this.height = 340;
    this.start = performance.now();
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
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
    this.world.game.ui.closePaperdoll(this.mobile.serial);
  }

  draw(ctx, now) {
    const m = this.mobile;
    ctx.fillStyle = 'rgba(24,20,14,0.96)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(m.name || 'Unknown', this.x + this.width / 2, this.y + 12);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#bfa96f';
    ctx.fillText(m.title || '', this.x + this.width / 2, this.y + 32);

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(this.x + 20, this.y + 56, this.width - 40, 190);
    ctx.strokeStyle = '#5f5133';
    ctx.strokeRect(this.x + 20.5, this.y + 56.5, this.width - 41, 189);

    const type = this.world.game.getAnimType(m.graphic);
    const group = type === 'people' ? 4 : type === 'low' ? 2 : 1;
    const dir = 1;
    const frame = this.world.assets.getAnim(m.graphic, group, dir, 0);
    if (frame) {
      const idx = Math.floor(((now - this.start) / 150) % frame.meta.frames.length);
      const f = frame.meta.frames[idx];
      if (f) {
        const scale = 2;
        const px = this.x + this.width / 2 - (f.w * scale) / 2 + f.cx * scale;
        const py = this.y + 240 - f.h * scale - f.cy * scale;
        ctx.drawImage(frame.img, f.x, f.y, f.w, f.h, px, py, f.w * scale, f.h * scale);
      }
    } else {
      ctx.fillStyle = '#9c8a5e';
      ctx.font = '14px monospace';
      ctx.fillText('No animation data', this.x + this.width / 2, this.y + 140);
    }

    let y = this.y + 256;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    const layers = [Layer.OneHanded, Layer.TwoHanded, Layer.Helm, Layer.Torso, Layer.Legs, Layer.Arms, Layer.Cloak, Layer.Mount];
    for (const layer of layers) {
      const item = m.getItem(layer);
      if (!item) continue;
      ctx.fillStyle = '#d9c58d';
      ctx.fillText(layerName(layer), this.x + 24, y);
      ctx.fillStyle = '#8fd6ff';
      ctx.fillText(`0x${item.graphic.toString(16)}`, this.x + 130, y);
      y += 18;
      if (y > this.y + this.height - 24) break;
    }
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

export class ShopWindow {
  constructor(world, serial, isBuy, title) {
    this.world = world;
    this.serial = serial;
    this.isBuy = isBuy;
    this.title = title || (isBuy ? 'Buy' : 'Sell');
    this.x = 180;
    this.y = 120;
    this.width = 360;
    this.height = 300;
    this.items = [];
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.scroll = 0;
  }

  addItem(item) {
    this.items.push(item);
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
    if (lx > this.width - 40 && ly < 30) {
      this.close();
      return true;
    }
    for (let i = 0; i < this.items.length; i++) {
      const y = 56 + i * 36 - this.scroll;
      if (ly >= y && ly < y + 34) {
        const item = this.items[i];
        if (this.isBuy) {
          this.world.socket.out.buy(this.serial, [[item.serial, 1]]);
        } else {
          this.world.socket.out.sell(this.serial, [[item.serial, 1]]);
        }
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
    }
  }

  onMouseUp() {
    this.dragging = false;
  }

  close() {
    this.world.game.ui.closeShop(this.serial);
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
    ctx.fillText(this.title, this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.fillText('X', this.x + this.width - 24, this.y + 10);
    ctx.font = '12px monospace';
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const y = this.y + 56 + i * 36 - this.scroll;
      if (y > this.y + this.height - 20) break;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(this.x + 8, y, this.width - 16, 32);
      const img = this.world.assets.getStatic(item.graphic, item.hue);
      if (img) {
        const scale = Math.min(1, 28 / Math.max(img.width, img.height));
        ctx.drawImage(img, this.x + 12, y + 2, img.width * scale, img.height * scale);
      }
      ctx.fillStyle = '#e8d7a8';
      ctx.fillText(item.name || `0x${item.graphic.toString(16)}`, this.x + 46, y + 4);
      ctx.fillStyle = '#9fd27a';
      ctx.fillText(`${item.price || item.amount || 1} gp`, this.x + this.width - 100, y + 4);
      ctx.fillStyle = '#7fc7ff';
      ctx.fillText(this.isBuy ? 'BUY' : 'SELL', this.x + this.width - 44, y + 4);
    }
  }
}

export class BookWindow {
  constructor(world, serial, title, author, pages, editable) {
    this.world = world;
    this.serial = serial;
    this.title = title || 'Book';
    this.author = author || '';
    this.pages = pages || 1;
    this.editable = editable;
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
    if (ly < 40 && lx > this.width - 30) {
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
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.title, this.x + this.width / 2, this.y + 12);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#bfa96f';
    ctx.fillText(this.author ? `by ${this.author}` : '', this.x + this.width / 2, this.y + 30);
    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    const lines = this.lines.get(this.page) || [];
    let y = this.y + 56;
    for (const line of lines) {
      ctx.fillText(line, this.x + 20, y);
      y += 16;
      if (y > this.y + this.height - 50) break;
    }
    if (!lines.length) {
      ctx.fillStyle = '#7b6d4d';
      ctx.fillText('Loading page...', this.x + 20, y);
    }
    ctx.fillStyle = '#e8d7a8';
    ctx.textAlign = 'center';
    ctx.fillText(`< ${this.page} / ${this.pages} >`, this.x + this.width / 2, this.y + this.height - 28);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9b06c';
    ctx.fillText('X', this.x + this.width - 24, this.y + 10);
  }
}

export class ProfileWindow {
  constructor(world, serial, header, footer, body) {
    this.world = world;
    this.serial = serial;
    this.header = header || '';
    this.footer = footer || '';
    this.body = body || '';
    this.x = 220;
    this.y = 120;
    this.width = 360;
    this.height = 320;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  onMouseDown(mx, my, button) {
    if (button === 2) return true;
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
    ctx.fillStyle = '#e8d7a8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.header || 'Profile', this.x + 12, this.y + 10);
    ctx.fillStyle = '#c9b06c';
    ctx.fillText('X', this.x + this.width - 24, this.y + 10);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#e8d7a8';
    let y = this.y + 34;
    for (const line of wrap(this.body, 48)) {
      ctx.fillText(line, this.x + 12, y);
      y += 16;
      if (y > this.y + this.height - 30) break;
    }
    if (this.footer) {
      ctx.fillStyle = '#bfa96f';
      ctx.fillText(this.footer, this.x + 12, this.y + this.height - 24);
    }
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
