import fs from 'node:fs';

/**
 * Parses Equipconv.def.
 *
 * Format: <bodyType> <equipmentAnimId> <convertToAnimId> <gumpId> <hue>
 * A gump id of 0 means "use equipmentAnimId", -1 means "use convertToAnimId".
 */
export class EquipConvManager {
  constructor(files) {
    this.files = files;
    this.loaded = false;
    this.data = new Map();
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const filePath = this.files.find('equipconv.def');
    if (!filePath) return;
    let text;
    try {
      text = fs.readFileSync(filePath, 'latin1');
    } catch {
      return;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/).map((part) => Number.parseInt(part, 10));
      if (parts.length < 5 || parts.some((value) => !Number.isFinite(value))) continue;
      const [body, graphic, converted, gumpId, color] = parts;
      if (body < 0 || body > 0xffff || graphic < 0 || graphic > 0xffff) continue;
      if (gumpId > 0xffff) continue;
      let gump = gumpId;
      if (gump === 0) gump = graphic;
      else if (gump === -1 || gump === 0xffff) gump = converted;
      let entries = this.data.get(body);
      if (!entries) this.data.set(body, (entries = new Map()));
      entries.set(graphic, {
        graphic: converted < 0 ? 0xffff : converted,
        gump,
        color: color > 0 ? color & 0xffff : 0,
      });
    }
  }

  toJSON() {
    this.load();
    const out = {};
    for (const [body, entries] of this.data) {
      const bodyOut = {};
      for (const [graphic, data] of entries) {
        bodyOut[graphic] = [data.graphic, data.gump, data.color];
      }
      out[body] = bodyOut;
    }
    return out;
  }
}
