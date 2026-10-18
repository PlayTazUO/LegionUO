import { Layer } from './entity.js';
import { drawServerText } from './html.js';

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
    this.press = null;
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

  itemAt(mx, my) {
    const lx = mx - this.x;
    const ly = my - this.y;
    const items = this.items;
    const cols = Math.max(1, Math.floor((this.width - 20) / 46));
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ix = 12 + col * 46;
      const iy = 30 + row * 46 + this.scroll;
      if (lx >= ix && ly >= iy && lx < ix + 44 && ly < iy + 44) return items[i];
    }
    return null;
  }

  tooltipAt(mx, my) {
    const item = this.itemAt(mx, my);
    if (!item) return null;
    return { id: `container:${this.serial}:${item.serial}`, serial: item.serial, title: item.name };
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      this.close();
      return true;
    }
    const item = this.itemAt(mx, my);
    if (item) {
      if (button === 0 && !this.world.held) this.press = { item, x: mx, y: my, moved: false };
      return true;
    }
    this.press = null;
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseUp(mx, my) {
    this.dragging = false;
    if (this.press && !this.press.moved) this.world.socket.out.singleClick(this.press.item.serial);
    this.press = null;
    if (this.world.held && this.contains(mx, my)) {
      const item = this.world.held;
      this.world.held = null;
      this.world.socket.out.drop(item.serial, 0, 0, 0, 0, this.serial);
    }
  }

  onItemDrop(mx, my) {
    if (!this.world.held || !this.contains(mx, my)) return false;
    const item = this.world.held;
    this.world.held = null;
    this.world.socket.out.drop(item.serial, 0, 0, 0, 0, this.serial);
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
    const items = this.items;
    const cols = Math.max(1, Math.floor((this.width - 20) / 46));
    const gridX = this.x + 6;
    const gridY = this.y + 6;
    const gridWidth = this.width - 12;
    const gridHeight = this.height - 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(gridX, gridY, gridWidth, gridHeight);
    ctx.clip();
    ctx.strokeStyle = 'rgba(198, 176, 126, 0.28)';
    ctx.lineWidth = 1;
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
      ctx.strokeRect(ix + 0.5, iy + 0.5, 43, 43);
    }
    ctx.restore();
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

  equipmentAt(mx, my) {
    const layers = [Layer.OneHanded, Layer.TwoHanded, Layer.Helm, Layer.Torso, Layer.Legs, Layer.Arms, Layer.Cloak, Layer.Mount];
    let y = this.y + 256;
    for (const layer of layers) {
      const item = this.mobile.getItem(layer);
      if (!item) continue;
      if (mx >= this.x + 20 && mx < this.x + this.width - 20 && my >= y && my < y + 18) return item;
      y += 18;
      if (y > this.y + this.height - 24) break;
    }
    return null;
  }

  tooltipAt(mx, my) {
    const item = this.equipmentAt(mx, my);
    if (!item) return null;
    return { id: `paperdoll:${this.mobile.serial}:${item.serial}`, serial: item.serial, title: item.name };
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
    const charName = m.name || 'Unknown';
    const charTitle = m.title || '';
    if (
      !drawServerText(ctx, charName, {
        x: this.x + 12,
        y: this.y + 12,
        width: this.width - 24,
        height: 18,
        align: 'center',
        defaultColor: '#e8d7a8',
        fontSize: 15,
        bold: true,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#e8d7a8';
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(charName, this.x + this.width / 2, this.y + 12);
    }
    if (
      !drawServerText(ctx, charTitle, {
        x: this.x + 12,
        y: this.y + 32,
        width: this.width - 24,
        height: 16,
        align: 'center',
        defaultColor: '#bfa96f',
        fontSize: 12,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#bfa96f';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(charTitle, this.x + this.width / 2, this.y + 32);
    }

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

export class StatusWindow {
  constructor(world) {
    this.world = world;
    this.x = 20;
    this.y = 20;
    this.width = 280;
    this.height = 236;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
  }

  get player() {
    return this.world.player;
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
    this.world.game.ui.closeStatus();
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
    if (
      !drawServerText(ctx, statusName, {
        x: left,
        y: this.y + 10,
        width,
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
      ctx.fillText(statusName, left, this.y + 10);
    }
    if (
      !drawServerText(ctx, statusTitle, {
        x: left,
        y: this.y + 30,
        width,
        height: 16,
        defaultColor: '#bfa96f',
        fontSize: 11,
        fontFamily: 'monospace',
        clip: true,
      })
    ) {
      ctx.fillStyle = '#bfa96f';
      ctx.font = '11px monospace';
      ctx.fillText(statusTitle, left, this.y + 30);
    }
    ctx.fillStyle = '#5f5133';
    ctx.fillRect(left, this.y + 48, width, 1);

    ctx.fillStyle = '#d9c58d';
    ctx.font = '12px monospace';
    ctx.fillText(`STR ${p.strength}   DEX ${p.dexterity}   INT ${p.intelligence}`, left, this.y + 56);

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
    ctx.fillText(`${p.x}, ${p.y}, ${p.z}`, left, this.y + 214);
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

  itemAt(mx, my) {
    const lx = mx - this.x;
    const ly = my - this.y;
    if (lx < 8 || lx >= this.width - 8) return null;
    for (let i = 0; i < this.items.length; i++) {
      const y = 56 + i * 36 - this.scroll;
      if (ly >= y && ly < y + 34) return this.items[i];
    }
    return null;
  }

  tooltipAt(mx, my) {
    const item = this.itemAt(mx, my);
    if (!item) return null;
    const price = item.price || item.amount || 1;
    return {
      id: `shop:${this.serial}:${item.serial}`,
      serial: item.serial,
      title: item.name,
      lines: [`${price} gp`],
    };
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
    if (
      !drawServerText(ctx, this.title, {
        x: this.x + 12,
        y: this.y + 10,
        width: this.width - 48,
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
      ctx.fillText(this.title, this.x + 12, this.y + 10);
    }
    ctx.fillStyle = '#c9b06c';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
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
      const itemName = item.name || `0x${item.graphic.toString(16)}`;
      ctx.fillStyle = '#e8d7a8';
      if (
        !drawServerText(ctx, itemName, {
          x: this.x + 46,
          y: y + 4,
          width: this.width - 160,
          height: 30,
          defaultColor: '#e8d7a8',
          fontSize: 12,
          fontFamily: 'monospace',
          clip: true,
        })
      ) {
        ctx.font = '12px monospace';
        ctx.fillText(itemName, this.x + 46, y + 4);
      }
      ctx.font = '12px monospace';
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
    if (
      !drawServerText(ctx, this.title, {
        x: this.x + 20,
        y: this.y + 12,
        width: this.width - 40,
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
      ctx.fillText(this.title, this.x + this.width / 2, this.y + 12);
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
    const headerText = this.header || 'Profile';
    if (
      !drawServerText(ctx, headerText, {
        x: this.x + 12,
        y: this.y + 10,
        width: this.width - 48,
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
      ctx.fillText(headerText, this.x + 12, this.y + 10);
    }
    ctx.fillStyle = '#c9b06c';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('X', this.x + this.width - 24, this.y + 10);
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
