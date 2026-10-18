export const Layer = {
  Invalid: 0,
  OneHanded: 1,
  TwoHanded: 2,
  Shoes: 3,
  Pants: 4,
  Shirt: 5,
  Helm: 6,
  Gloves: 7,
  Ring: 8,
  Talisman: 9,
  Necklace: 10,
  Hair: 11,
  Waist: 12,
  Torso: 13,
  Bracelet: 14,
  Face: 15,
  Beard: 16,
  Tunic: 17,
  Earrings: 18,
  Arms: 19,
  Cloak: 20,
  Backpack: 21,
  Robe: 22,
  Skirt: 23,
  Legs: 24,
  Mount: 25,
  ShopBuyRestock: 26,
  ShopBuy: 27,
  ShopSell: 28,
  Bank: 29,
};

const GHOST_GRAPHICS = new Set([0x0192, 0x0193, 0x02b6, 0x02b7]);

export function isGhostGraphic(graphic) {
  return GHOST_GRAPHICS.has(graphic & 0x7fff);
}

export class Entity {
  constructor(serial, isMobile) {
    this.serial = serial >>> 0;
    this.isMobile = isMobile;
    this.graphic = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.direction = 0;
    this.hue = 0;
    this.flags = 0;
    this.name = '';
    this.hits = 0;
    this.hitsMax = 0;
    this.notoriety = 0;
    this.container = 0;
    this.layer = Layer.Invalid;
    this.amount = 1;
    this.items = new Map();
    this.equipment = new Map();
    this.mount = null;
    this.isCorpse = false;
    this.corpseParent = 0;
    this.opened = false;
    this.animation = {
      group: 0,
      frame: 0,
      start: performance.now(),
      repeat: false,
      forward: true,
      frameCount: 0,
      repeatCount: 0,
      delay: 0,
      fromServer: false,
    };
    this.walkQueue = [];
    this.walking = false;
    this.lastStepTime = 0;
    this.moving = false;
    this.moveStart = 0;
    this.moveFrom = null;
    this.renderX = 0;
    this.renderY = 0;
    this.renderZ = 0;
    this.motion = null;
    this.motionQueue = [];
    this.hasPosition = false;
    this.isDead = false;
    this.isGhost = false;
    this.livingGraphic = 0;
    this.isRenamable = false;
    this.isFemale = false;
    this.race = 1;
    this.gold = 0;
    this.strength = 0;
    this.dexterity = 0;
    this.intelligence = 0;
    this.mana = 0;
    this.manaMax = 0;
    this.stamina = 0;
    this.staminaMax = 0;
    this.weight = 0;
    this.weightMax = 0;
    this.title = '';
    this.buffs = [];
    this.price = 0;
    this.spells = null;
    this.spellbookType = 0;
  }

  get isItem() {
    return !this.isMobile;
  }

  addItem(item) {
    if (item.layer !== Layer.Invalid) {
      const existing = this.equipment.get(item.layer);
      if (existing) this.equipment.delete(existing.serial);
      this.equipment.set(item.layer, item);
    }
    this.items.set(item.serial, item);
  }

  removeItem(item) {
    this.items.delete(item.serial);
    if (item.layer !== Layer.Invalid) {
      const existing = this.equipment.get(item.layer);
      if (existing && existing.serial === item.serial) this.equipment.delete(item.layer);
    }
  }

  getItem(layer) {
    return this.equipment.get(layer) || null;
  }
}

export function isMobileSerial(serial) {
  return serial > 0 && serial < 0x40000000;
}

export function isItemSerial(serial) {
  return serial >= 0x40000000 && serial < 0x80000000;
}

export function directionFromPoints(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const rx = (dx - dy) * 44;
  const ry = (dx + dy) * 44;
  const ax = Math.abs(rx);
  const ay = Math.abs(ry);
  if ((ay >> 1) - ax >= 0) return ry > 0 ? 7 : 3;
  if ((ax >> 1) - ay >= 0) return rx > 0 ? 5 : 1;
  if (rx >= 0 && ry >= 0) return 6;
  if (rx >= 0 && ry < 0) return 4;
  if (rx < 0 && ry >= 0) return 0;
  return 2;
}

export function animDirection(direction) {
  let dir = direction & 7;
  let mirror = false;
  switch (dir) {
    case 2:
    case 4:
      mirror = dir === 2;
      dir = 1;
      break;
    case 1:
    case 5:
      mirror = dir === 1;
      dir = 2;
      break;
    case 0:
    case 6:
      mirror = dir === 0;
      dir = 3;
      break;
    case 3:
      dir = 0;
      break;
    case 7:
      dir = 4;
      break;
    default:
      dir = 0;
  }
  return { dir, mirror };
}
