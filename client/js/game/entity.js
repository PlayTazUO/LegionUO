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
const FEMALE_BODIES = new Set([0x0191, 0x0193, 0x025e, 0x029b, 0x02b7]);
const MALE_BODIES = new Set([0x0190, 0x0192, 0x025d, 0x029a, 0x02b6]);
const GARGOYLE_BODIES = new Set([0x029a, 0x029b, 0x02b6, 0x02b7]);
const GHOST_BODY_BASE = new Map([
  [0x0192, 0x0190],
  [0x0193, 0x0191],
  [0x02b6, 0x029a],
  [0x02b7, 0x029b],
]);

// ClassicUO's default paperdoll layer table (T2) minus Backpack/Mount. It is
// used for both the paperdoll and the layered in-world mobile rendering.
export const EQUIPMENT_LAYER_ORDER = [
  Layer.Cloak,
  Layer.Shirt,
  Layer.Pants,
  Layer.Shoes,
  Layer.Legs,
  Layer.Arms,
  Layer.Torso,
  Layer.Tunic,
  Layer.Ring,
  Layer.Bracelet,
  Layer.Face,
  Layer.Gloves,
  Layer.Skirt,
  Layer.Robe,
  Layer.Waist,
  Layer.Necklace,
  Layer.Hair,
  Layer.Beard,
  Layer.Earrings,
  Layer.Helm,
  Layer.OneHanded,
  Layer.TwoHanded,
  Layer.Talisman,
];

const LAYER_ORDER_ARMS_LATE = [
  Layer.Cloak,
  Layer.Shirt,
  Layer.Pants,
  Layer.Shoes,
  Layer.Legs,
  Layer.Torso,
  Layer.Tunic,
  Layer.Ring,
  Layer.Bracelet,
  Layer.Face,
  Layer.Arms,
  Layer.Gloves,
  Layer.Skirt,
  Layer.Robe,
  Layer.Waist,
  Layer.Necklace,
  Layer.Hair,
  Layer.Beard,
  Layer.Earrings,
  Layer.Helm,
  Layer.OneHanded,
  Layer.TwoHanded,
  Layer.Talisman,
];

const LAYER_ORDER_TORSO_FRONT = [
  Layer.Cloak,
  Layer.Torso,
  Layer.Shirt,
  Layer.Pants,
  Layer.Shoes,
  Layer.Legs,
  Layer.Tunic,
  Layer.Ring,
  Layer.Bracelet,
  Layer.Face,
  Layer.Arms,
  Layer.Gloves,
  Layer.Skirt,
  Layer.Robe,
  Layer.Waist,
  Layer.Necklace,
  Layer.Hair,
  Layer.Beard,
  Layer.Earrings,
  Layer.Helm,
  Layer.OneHanded,
  Layer.TwoHanded,
  Layer.Talisman,
];

export function isGhostGraphic(graphic) {
  return GHOST_GRAPHICS.has(graphic & 0x7fff);
}

export function isGargoyleBody(graphic) {
  return GARGOYLE_BODIES.has((graphic & 0x7fff) || 0);
}

export function isFemaleMobile(mobile) {
  if (!mobile) return false;
  const graphic = (mobile.graphic & 0x7fff) || 0;
  if (FEMALE_BODIES.has(graphic)) return true;
  if (MALE_BODIES.has(graphic)) return false;
  return !!(mobile.isFemale || (mobile.flags & 0x02));
}

export function baseBodyGraphic(mobile) {
  const graphic = (mobile?.graphic & 0x7fff) || 0;
  return GHOST_BODY_BASE.get(graphic) ?? graphic;
}

function indexOfLayer(order, layer) {
  return order.indexOf(layer);
}

function moveToLayer(order, move, target) {
  const from = indexOfLayer(order, move);
  const to = indexOfLayer(order, target);
  if (from < 0 || to < 0 || from === to) return;
  order.splice(from, 1);
  order.splice(to, 0, move);
}

function moveAfterLayer(order, move, target) {
  const from = indexOfLayer(order, move);
  const to = indexOfLayer(order, target);
  if (from < 0 || to < 0 || from === to) return;
  order.splice(from, 1);
  const insert = indexOfLayer(order, target);
  order.splice(insert + 1, 0, move);
}

/**
 * Build the back-to-front equipment layer order for a mobile.
 *
 * Mirrors ClassicUO's PaperdollOrder: choose a base table from the arms/torso
 * anim ids, apply the per-graphic reorder rules, then (for world rendering)
 * move the cloak according to facing direction.
 */
export function buildEquipmentOrder(mobile, assets, { direction = -1, altTorso = false } = {}) {
  const graphic = (layer) => {
    const item = mobile?.getItem?.(layer);
    return item ? assets.staticAnimId(item.graphic) || 0 : 0;
  };

  let order;
  const arms = graphic(Layer.Arms);
  const armsAlternate = arms >= 0x3d0 ? arms === 0x3dd : arms === 0x3cf || arms === 0x210 || arms === 0x3b3;
  if (armsAlternate) {
    order = LAYER_ORDER_ARMS_LATE.slice();
  } else {
    const torso = graphic(Layer.Torso);
    if (torso === 0x21a) order = LAYER_ORDER_ARMS_LATE.slice();
    else if (torso >= 0x399 && torso < 0x39e && altTorso) order = LAYER_ORDER_TORSO_FRONT.slice();
    else order = EQUIPMENT_LAYER_ORDER.slice();
  }

  if (graphic(Layer.Shirt) !== 0 && graphic(Layer.Pants) === 0x398) {
    moveToLayer(order, Layer.Pants, Layer.Shirt);
  }

  const pants = graphic(Layer.Pants);
  let skipFinalPantsCheck = false;
  if (pants < 0x201) {
    if (pants === 0x200 || pants === 0x1eb || pants === 0x1fa) {
      const shoes = indexOfLayer(order, Layer.Shoes);
      const pantsIndex = indexOfLayer(order, Layer.Pants);
      if (shoes >= 0 && pantsIndex >= 0 && pantsIndex < shoes) {
        order[shoes] = Layer.Pants;
        order[pantsIndex] = Layer.Shoes;
      }
    }
  } else if (pants === 0x513 || pants === 0x514) {
    if (graphic(Layer.Shoes) !== 0) moveToLayer(order, Layer.Pants, Layer.Shoes);
    skipFinalPantsCheck = true;
  }

  if (!skipFinalPantsCheck && graphic(Layer.Shoes) !== 0 && graphic(Layer.Pants) === 0x3e4) {
    moveToLayer(order, Layer.Pants, Layer.Shoes);
  }

  if (graphic(Layer.Tunic) === 0x238) {
    moveAfterLayer(order, Layer.Tunic, Layer.Waist);
    if (graphic(Layer.Robe) !== 0) {
      const robe = graphic(Layer.Robe);
      if (
        robe === 0x4e8 ||
        robe === 0x4e9 ||
        robe === 0x4ea ||
        robe === 0x4eb ||
        robe === 0x5e2 ||
        robe === 0x5e3 ||
        robe === 0x5e4 ||
        robe === 0x5e5
      ) {
        moveToLayer(order, Layer.Robe, Layer.Necklace);
      }
    }
  }

  const cloak = graphic(Layer.Cloak);
  if (cloak === 0x380 || cloak === 0x5f3) moveAfterLayer(order, Layer.Cloak, Layer.Robe);

  const helm = graphic(Layer.Helm);
  if (helm < 0x202) {
    const neck = graphic(Layer.Necklace);
    if ((helm === 0x201 || helm === 0x1a9) && (neck === 0x1c8 || (neck > 0x1d6 && neck < 0x1d9))) {
      moveAfterLayer(order, Layer.Necklace, Layer.Helm);
    }
  } else if (helm >= 0x5e9 && helm < 0x5eb && graphic(Layer.Robe) !== 0) {
    const robe = graphic(Layer.Robe);
    if (robe >= 0x5e2 && robe < 0x5e6) moveToLayer(order, Layer.Robe, Layer.Helm);
  }

  if (direction >= 0) {
    const cloakIndex = indexOfLayer(order, Layer.Cloak);
    if (cloakIndex >= 0) {
      order.splice(cloakIndex, 1);
      let insert = order.length;
      if (direction === 3) insert = 0;
      else if (direction !== 0) {
        const helmIndex = indexOfLayer(order, Layer.Helm);
        if (helmIndex >= 0) insert = helmIndex;
      }
      order.splice(insert, 0, Layer.Cloak);
    }
  }

  return order;
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
    this.animRender = null;
    this.turnAnimGraceUntil = 0;
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
