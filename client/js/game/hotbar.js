const HOTBAR_STORAGE_BASE = 'legionuo.hotbar.v1';
const SLOT_COUNT = 12;
const PAGE_COUNT = 3;
const SLOT_SIZE = 40;
const SLOT_GAP = 4;
const PAD = 6;
const HEADER = 20;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];

function storageKey(world) {
  const account = (world.game?.loginCredentials?.account || '').trim().toLowerCase();
  return account ? `${HOTBAR_STORAGE_BASE}.${account}` : HOTBAR_STORAGE_BASE;
}

function clampPosition(x, y, width, height) {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - height))),
  };
}

function normalizeSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  if (slot.type === 'item') {
    const serial = Number(slot.serial);
    if (!Number.isFinite(serial) || serial <= 0) return null;
    return {
      type: 'item',
      serial: serial >>> 0,
      graphic: Number(slot.graphic) || 0,
      hue: Number(slot.hue) || 0,
      name: String(slot.name || 'Item'),
    };
  }
  if (slot.type === 'spell') {
    const id = Number(slot.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return {
      type: 'spell',
      id,
      name: String(slot.name || `Spell ${id}`),
      mana: slot.mana == null ? null : Number(slot.mana),
      icon: Number(slot.icon) || 0,
      school: String(slot.school || ''),
    };
  }
  if (slot.type === 'skill') {
    const index = Number(slot.index);
    if (!Number.isFinite(index) || index < 0) return null;
    return { type: 'skill', index, name: String(slot.name || `Skill ${index}`) };
  }
  if (slot.type === 'command') {
    const command = String(slot.command || '').trim();
    if (!command) return null;
    return {
      type: 'command',
      command: command.startsWith('-') ? command : `-${command}`,
      name: String(slot.name || command),
    };
  }
  if (slot.type === 'macro') {
    const steps = Array.isArray(slot.steps) ? slot.steps.map((step) => String(step || '').trim()).filter(Boolean) : [];
    if (!steps.length) return null;
    return { type: 'macro', name: String(slot.name || 'Macro'), steps };
  }
  return null;
}

export function hotbarItemSlot(item) {
  if (!item) return null;
  return normalizeSlot({
    type: 'item',
    serial: item.serial,
    graphic: item.graphic,
    hue: item.hue,
    name: item.name || `Item ${item.serial}`,
  });
}

export function hotbarSpellSlot(spell) {
  if (!spell) return null;
  return normalizeSlot({
    type: 'spell',
    id: spell.id,
    name: spell.name,
    mana: spell.mana,
    icon: spell.icon,
    school: spell.school,
  });
}

export function hotbarSkillSlot(skill) {
  if (!skill) return null;
  return normalizeSlot({ type: 'skill', index: skill.index, name: skill.name });
}

export function hotbarCommandSlot(command, name) {
  return normalizeSlot({ type: 'command', command, name });
}

export function hotbarMacroSlot(name, steps) {
  return normalizeSlot({ type: 'macro', name, steps });
}

export function macroStorageKey(world) {
  const account = (world.game?.loginCredentials?.account || '').trim().toLowerCase();
  return account ? `legionuo.macros.v1.${account}` : 'legionuo.macros.v1';
}

export function loadMacros(world) {
  try {
    const saved = JSON.parse(localStorage.getItem(macroStorageKey(world)) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function saveMacros(world, macros) {
  try {
    localStorage.setItem(macroStorageKey(world), JSON.stringify(macros));
  } catch {
    /* ignore quota errors */
  }
}

export function hotbarSlotForKey(code) {
  const index = KEY_CODES.indexOf(code);
  if (index >= 0) return index;
  if (code === 'NumpadAdd') return 11;
  if (code === 'NumpadSubtract') return 10;
  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) {
    const n = Number(numpad[1]);
    return n === 0 ? 9 : n - 1;
  }
  return -1;
}

export class HotbarWindow {
  constructor(world) {
    this.world = world;
    this.dragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.hoverIndex = -1;
    this.width = PAD * 2 + SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
    this.height = HEADER + PAD * 2 + SLOT_SIZE;
    const fallback = clampPosition(
      Math.round((window.innerWidth - this.width) / 2),
      Math.max(40, window.innerHeight - this.height - 96),
      this.width,
      this.height
    );
    this.x = fallback.x;
    this.y = fallback.y;
    this.page = 0;
    this.pages = Array.from({ length: PAGE_COUNT }, () => new Array(SLOT_COUNT).fill(null));
    this.load();
  }

  get slots() {
    return this.pages[this.page];
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(this.world)) || 'null');
      if (!saved || typeof saved !== 'object') return;
      if (Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
        const pos = clampPosition(Number(saved.x), Number(saved.y), this.width, this.height);
        this.x = pos.x;
        this.y = pos.y;
      }
      this.page = Math.max(0, Math.min(PAGE_COUNT - 1, Number(saved.page) || 0));
      if (Array.isArray(saved.pages)) {
        for (let p = 0; p < PAGE_COUNT; p++) {
          const page = saved.pages[p];
          if (!Array.isArray(page)) continue;
          for (let i = 0; i < SLOT_COUNT; i++) this.pages[p][i] = normalizeSlot(page[i]);
        }
      } else if (Array.isArray(saved.slots)) {
        for (let i = 0; i < SLOT_COUNT; i++) this.pages[0][i] = normalizeSlot(saved.slots[i]);
      }
    } catch {
      /* ignore corrupt saved hotbar */
    }
  }

  save() {
    try {
      localStorage.setItem(
        storageKey(this.world),
        JSON.stringify({ x: Math.round(this.x), y: Math.round(this.y), page: this.page, pages: this.pages })
      );
    } catch {
      /* ignore quota errors */
    }
  }

  contains(mx, my) {
    return mx >= this.x && my >= this.y && mx < this.x + this.width && my < this.y + this.height;
  }

  closeRect() {
    return { x: this.x + this.width - 20, y: this.y + 4, w: 14, h: 14 };
  }

  pageRect(dir) {
    return { x: this.x + this.width - (dir > 0 ? 58 : 82), y: this.y + 4, w: 20, h: 14 };
  }

  slotRect(index) {
    return {
      x: this.x + PAD + index * (SLOT_SIZE + SLOT_GAP),
      y: this.y + HEADER + PAD,
      w: SLOT_SIZE,
      h: SLOT_SIZE,
    };
  }

  slotAt(mx, my) {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const rect = this.slotRect(i);
      if (mx >= rect.x && my >= rect.y && mx < rect.x + rect.w && my < rect.y + rect.h) return i;
    }
    return -1;
  }

  tooltipAt(mx, my) {
    const index = this.slotAt(mx, my);
    if (index < 0) return null;
    const slot = this.slots[index];
    if (!slot) return { id: `hotbar:${index}`, title: `Slot ${index + 1}`, lines: [`Key ${KEYS[index]}`, 'Empty'] };
    const type = { item: 'Item', spell: 'Spell', skill: 'Skill', command: 'Command', macro: 'Macro' }[slot.type] || 'Action';
    return {
      id: `hotbar:${index}`,
      title: slot.name || type,
      lines: [type, `Key ${KEYS[index]}`, 'Right-click to clear'],
    };
  }

  setSlot(index, slot) {
    if (index < 0 || index >= SLOT_COUNT) return false;
    const normalized = normalizeSlot(slot);
    if (!normalized) return false;
    this.slots[index] = normalized;
    this.save();
    return true;
  }

  clearSlot(index) {
    if (index < 0 || index >= SLOT_COUNT) return false;
    this.slots[index] = null;
    this.save();
    return true;
  }

  use(index) {
    const slot = this.slots[index];
    if (!slot) return false;
    const out = this.world.socket.out;
    if (slot.type === 'item') {
      const item = this.world.getItem(slot.serial);
      if (!item) {
        this.world.addMessage('That hotbar item is no longer available.', 0x22, 1, 'System');
        return false;
      }
      out.doubleClick(item.serial);
      return true;
    }
    if (slot.type === 'spell') {
      const player = this.world.player;
      if (slot.mana != null && player && player.mana < slot.mana) {
        this.world.addMessage(`You do not have enough mana to cast ${slot.name}.`, 0x22, 1, 'System');
        return false;
      }
      out.castSpell(slot.id);
      return true;
    }
    if (slot.type === 'skill') {
      out.useSkill(slot.index);
      return true;
    }
    if (slot.type === 'command') {
      this.world.game.ui?.command(slot.command);
      return true;
    }
    if (slot.type === 'macro') {
      for (const step of slot.steps) this.world.game.ui?.command(step);
      return true;
    }
    return false;
  }

  onItemDrop(mx, my) {
    const index = this.slotAt(mx, my);
    const item = this.world.held;
    if (index < 0 || !item) return false;
    const source = item.container >>> 0;
    const layer = item.layer || 0;
    const x = item.x || 0;
    const y = item.y || 0;
    const z = item.z || 0;
    this.world.held = null;
    if (layer && source) {
      this.world.socket.out.equip(item.serial, layer, source);
    } else if (source) {
      this.world.socket.out.drop(item.serial, x, y, 0, 0, source);
    } else {
      this.world.socket.out.drop(item.serial, x, y, z, 0, 0);
    }
    const slot = hotbarItemSlot(item);
    if (slot && this.setSlot(index, slot)) {
      this.world.addMessage(`Bound ${slot.name} to hotbar slot ${index + 1}.`, 0x35, 1, 'System');
    }
    return true;
  }

  onMouseDown(mx, my, button) {
    if (button === 2) {
      const index = this.slotAt(mx, my);
      if (index >= 0) {
        this.clearSlot(index);
        return true;
      }
      this.close();
      return true;
    }
    const prev = this.pageRect(-1);
    const next = this.pageRect(1);
    if (mx >= prev.x && my >= prev.y && mx < prev.x + prev.w && my < prev.y + prev.h) {
      this.page = (this.page + PAGE_COUNT - 1) % PAGE_COUNT;
      this.save();
      return true;
    }
    if (mx >= next.x && my >= next.y && mx < next.x + next.w && my < next.y + next.h) {
      this.page = (this.page + 1) % PAGE_COUNT;
      this.save();
      return true;
    }
    const close = this.closeRect();
    if (mx >= close.x && my >= close.y && mx < close.x + close.w && my < close.y + close.h) {
      this.close();
      return true;
    }
    if (button === 0) {
      const index = this.slotAt(mx, my);
      if (index >= 0) {
        this.use(index);
        return true;
      }
    }
    this.dragging = true;
    this.dragOffset.x = mx - this.x;
    this.dragOffset.y = my - this.y;
    return true;
  }

  onMouseMove(mx, my) {
    this.hoverIndex = this.slotAt(mx, my);
    if (this.dragging) {
      this.x = mx - this.dragOffset.x;
      this.y = my - this.dragOffset.y;
      const pos = clampPosition(this.x, this.y, this.width, this.height);
      this.x = pos.x;
      this.y = pos.y;
    }
  }

  onMouseUp() {
    if (this.dragging) this.save();
    this.dragging = false;
  }

  close() {
    this.save();
    this.world.game.ui?.closeHotbar();
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(18,15,10,0.92)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = '#8d7a52';
    ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);

    ctx.fillStyle = '#c9b06c';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Hotbar', this.x + PAD, this.y + 5);
    ctx.fillStyle = '#6f6244';
    ctx.font = '9px monospace';
    ctx.fillText(`P${this.page + 1}`, this.x + PAD + 42, this.y + 6);
    for (const [dir, label] of [[-1, '<'], [1, '>']]) {
      const rect = this.pageRect(dir);
      ctx.fillStyle = '#8d7a52';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = '#1a150d';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const close = this.closeRect();
    ctx.fillStyle = '#8d7a52';
    ctx.fillRect(close.x, close.y, close.w, close.h);
    ctx.fillStyle = '#1a150d';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('x', close.x + close.w / 2, close.y + close.h / 2 + 1);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const rect = this.slotRect(i);
      const slot = this.slots[i];
      const hover = this.hoverIndex === i;
      ctx.fillStyle = hover ? '#2d2618' : '#1b1710';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = hover ? '#e8d7a8' : '#5f5133';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      if (slot) this.drawSlot(ctx, rect, slot);
      ctx.fillStyle = slot ? '#c9b06c' : '#6f6244';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(KEYS[i], rect.x + rect.w - 3, rect.y + rect.h - 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (!slot) ctx.fillText(KEYS[i], rect.x + rect.w / 2, rect.y + rect.h / 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  drawSlot(ctx, rect, slot) {
    if (slot.type === 'item') {
      const img = this.world.assets.getStatic(slot.graphic, slot.hue || 0);
      if (img && img.width > 0 && img.height > 0) {
        const size = rect.w - 12;
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
        return;
      }
      this.drawLetter(ctx, rect, slot.name, '#d9c58d');
      return;
    }
    if (slot.type === 'spell' && slot.icon) {
      const img = this.world.assets.getGump(slot.icon);
      if (img && img.width > 0 && img.height > 0) {
        const size = rect.w - 8;
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
        return;
      }
    }
    const color = slot.type === 'spell' ? '#8fb6d9' : slot.type === 'skill' ? '#9fd08f' : '#d9b98d';
    this.drawLetter(ctx, rect, slot.name, color);
  }

  drawLetter(ctx, rect, name, color) {
    const label = String(name || '?').replace(/^-/, '').slice(0, 5);
    ctx.fillStyle = color;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 - 2);
  }
}
