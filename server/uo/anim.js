import fs from 'node:fs';
import { createHash } from './files.js';
import { color16To32 } from './colors.js';

export const MAX_ACTIONS = 80;
export const MAX_DIRECTIONS = 5;

const GROUP_COUNTS = {
  low: 13,
  high: 23,
  people: 35,
};

const GROUP_NAMES = {
  monster: 'high',
  sea_monster: 'high',
  animal: 'low',
  human: 'people',
  equipment: 'equipment',
};

// mobtypes.txt flag that tells the client to read this graphic from the
// AnimationFrame*.uop files instead of anim*.mul. Shards use it for custom
// equipment and creatures, and those ids often also have a stale row in
// bodyconv.def - the UOP data must win.
const MOB_TYPE_USE_UOP_ANIMATION = 0x10000;

export class AnimationsManager {
  constructor(files, hues) {
    this.files = files;
    this.hues = hues;
    this.loaded = false;
    this.filesMul = [];
    this.filesUop = [];
    this.hasUopAnimations = false;
    this.bodyConv = new Map();
    this.bodyDef = new Map();
    this.mobTypes = new Map();
    this.resolveCache = new Map();
    this.uopGroups = new Map();
    this.frameEntryCache = new Map();
    this.empty = [];
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;

    for (let i = 0; i < 10; i++) {
      const name = i === 0 ? 'anim.mul' : `anim${i + 1}.mul`;
      const idx = i === 0 ? 'anim.idx' : `anim${i + 1}.idx`;
      const mul = this.files.mul(name, idx);
      this.filesMul[i] = mul;
    }
    for (let i = 0; i < 10; i++) {
      const uop = this.files.getUopRaw(`AnimationFrame${i + 1}.uop`);
      this.filesUop[i] = uop;
      if (uop) this.hasUopAnimations = true;
    }

    this.parseMobTypes();
    this.parseBodyConv();
    this.parseBodyDef();
    this.parseAnimationSequence();
  }

  /**
   * AnimationSequence.uop maps an action that has no frame of its own (for
   * example an idle group on a weapon) onto the action the archive really
   * contains. TazUO applies this before reading UOP frames.
   */
  parseAnimationSequence() {
    const spec = this.files.uop('AnimationSequence.uop', 'build/animationsequence/{0:D8}.bin');
    if (!spec) return;
    for (const entry of spec.entries) {
      if (!entry || entry.length <= 0) continue;
      const buf = this.files.readEntry(spec, entry);
      if (!buf || buf.length < 72) continue;
      const animId = buf.readUInt32LE(0);
      let ptr = 52;
      const replaces = buf.readInt32LE(ptr);
      ptr += 4;
      if (replaces === 48 || replaces === 68) continue;
      const actions = new Array(MAX_ACTIONS);
      for (let i = 0; i < MAX_ACTIONS; i++) actions[i] = i;
      let changed = false;
      for (let i = 0; i < replaces && ptr + 72 <= buf.length; i++) {
        const oldGroup = buf.readInt32LE(ptr);
        const frameCount = buf.readUInt32LE(ptr + 4);
        const newGroup = buf.readInt32LE(ptr + 8);
        if (frameCount === 0 && oldGroup >= 0 && oldGroup < MAX_ACTIONS) {
          actions[oldGroup] = newGroup;
          changed = true;
        }
        ptr += 72;
      }
      if (changed) this.uopGroups.set(animId, actions);
    }
  }

  mapUopAction(graphic, action) {
    const map = this.uopGroups.get(graphic);
    const mapped = map ? map[action] : action;
    return mapped >= 0 && mapped < MAX_ACTIONS ? mapped : action;
  }

  parseMobTypes() {
    const file = this.files.find('mobtypes.txt');
    if (!file) return;
    try {
      const text = fs.readFileSync(file, 'latin1');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !/^[0-9]/.test(trimmed)) continue;
        const parts = trimmed.split(/[\t ]+/);
        if (parts.length < 3) continue;
        const id = parseInt(parts[0], 10);
        const type = parts[1].toLowerCase();
        const flags = parseInt(parts[2].replace(/#.*/, ''), 16);
        if (Number.isFinite(id)) {
          this.mobTypes.set(id, { type: GROUP_NAMES[type] || null, flags: flags >>> 0 });
        }
      }
    } catch {
      /* ignore */
    }
  }

  parseBodyConv() {
    const file = this.files.find('bodyconv.def');
    if (!file) return;
    try {
      const text = fs.readFileSync(file, 'latin1');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.replace(/#.*/, '').trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/[\t ,]+/).map((x) => parseInt(x, 10));
        if (parts.length < 2 || !Number.isFinite(parts[0])) continue;
        const index = parts[0];
        for (let i = 1; i < parts.length && i < 10; i++) {
          const body = parts[i];
          if (!Number.isFinite(body) || body < 0) continue;
          this.bodyConv.set(index, { fileIndex: i, body, type: this.calcType(body, i) });
        }
      }
    } catch {
      /* ignore */
    }
  }

  parseBodyDef() {
    const file = this.files.find('body.def');
    if (!file) return;
    try {
      const text = fs.readFileSync(file, 'latin1');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.replace(/#.*/, '').trim();
        if (!trimmed) continue;
        // Format: <orig body> {<new body>[, <new body>...]} <hue>
        const match = trimmed.match(/^(\d+)\s*\{([^}]*)\}(?:\s+(-?\d+))?/);
        if (!match) continue;
        const index = Number.parseInt(match[1], 10);
        const group = match[2]
          .split(/[\s,]+/)
          .map((part) => Number.parseInt(part, 10))
          .filter((value) => Number.isFinite(value));
        if (!group.length) continue;
        const graphic = group.length >= 3 ? group[2] : group[0];
        const hue = Number.parseInt(match[3] || '0', 10) || 0;
        this.bodyDef.set(index, { graphic, hue });
      }
    } catch {
      /* ignore */
    }
  }

  calcType(body, fileIndex = 0) {
    if (fileIndex === 1) return body < 200 ? 'high' : 'low';
    if (fileIndex === 2) return body < 300 ? 'low' : body < 400 ? 'high' : 'people';
    return body < 200 ? 'high' : body < 400 ? 'low' : 'people';
  }

  resolve(body) {
    this.load();
    const cached = this.resolveCache.get(body);
    if (cached) return cached;

    let graphic = body;
    let fileIndex = 0;
    let type = null;
    let bodyHue = 0;
    const mob = this.mobTypes.get(body);
    if (mob && mob.type) type = mob.type;
    // A UseUopAnimation flag is meaningless when the install has no
    // AnimationFrame archives (older MUL-only shards still carry the flag).
    const useUop = this.hasUopAnimations && !!mob && (mob.flags & MOB_TYPE_USE_UOP_ANIMATION) !== 0;

    // The shard's own animation is keyed by the original graphic id in the
    // UOP archives. Applying Bodyconv.def here would replace it with the
    // vanilla fallback (for example 585 -> 100) and lose the custom art.
    let converted = false;
    if (!useUop && this.filesMul[0]) {
      const conv = this.bodyConv.get(body);
      if (conv && this.filesMul[conv.fileIndex]) {
        graphic = conv.body;
        fileIndex = conv.fileIndex;
        // TazUO keeps the mobtypes type for modern clients; Bodyconv.def only
        // supplies its own type when the graphic is not in mobtypes.txt.
        if (!type) type = conv.type;
        converted = true;
      }
    }
    // TazUO only consults Body.def when Bodyconv.def did not already supply
    // an animation file. Applying it on top of a bodyconv result points at
    // the wrong body (for example 746 -> 53, then 746 -> 9).
    if (!useUop && !converted && this.bodyDef.has(body)) {
      const replacement = this.bodyDef.get(body);
      graphic = replacement.graphic;
      bodyHue = replacement.hue;
      const mapped = this.mobTypes.get(graphic);
      type = mapped?.type || this.calcType(graphic, fileIndex);
    }
    if (!type) type = this.calcType(graphic, fileIndex);
    const result = { graphic, fileIndex, type, useUop, bodyHue };
    this.resolveCache.set(body, result);
    return result;
  }

  actionCount(type) {
    return GROUP_COUNTS[type] || GROUP_COUNTS.people;
  }

  offsetFor(graphic, type) {
    if (type === 'people' || type === 'equipment') return ((graphic - 400) * 175 + 35000) * 12;
    if (type === 'low') return ((graphic - 200) * 65 + 22000) * 12;
    return graphic * 110 * 12;
  }

  /**
   * Get decoded frames for a mobile graphic/action/direction.
   * Returns [{centerX, centerY, width, height, pixels}]
   */
  getFrames(body, action, direction, hue = 0, equip = false, partial = false) {
    this.load();
    const resolved = this.resolve(body);
    const type = resolved.type;
    const graphic = resolved.graphic;
    const fileIndex = resolved.fileIndex;
    const count = this.actionCount(type);

    if (action >= count || direction >= MAX_DIRECTIONS) return this.empty;

    // Equipment layers must never draw a creature/animal animation (a ring
    // whose AnimID happens to point at a zebra is the classic symptom).
    // TazUO only accepts Equipment/Human animation types on equipment.
    if (equip && type !== 'equipment' && type !== 'people') return this.empty;
    if (resolved.bodyHue) hue = resolved.bodyHue;

    // Modern UO ships animation frames in UOP archives. They are keyed by
    // body/action and carry every direction inside one entry. Shards can
    // alias an action (AnimationSequence.uop) when the archive has no frame
    // for the group the mobile is currently playing.
    const uopAction = resolved.useUop ? this.mapUopAction(graphic, action) : action;
    const frameKey = `${graphic}|${uopAction}`;
    if (!this.frameEntryCache.has(frameKey)) {
      let found = null;
      const name = `build/animationlegacyframe/${String(graphic).padStart(6, '0')}/${String(uopAction).padStart(2, '0')}.bin`;
      const hash = createHash(name);
      for (let i = 0; i < 10; i++) {
        const spec = this.filesUop[i];
        if (!spec) continue;
        const entry = spec.hashes.get(hash);
        if (entry) {
          found = { spec, entry };
          break;
        }
      }
      this.frameEntryCache.set(frameKey, found);
    }
    const frameEntry = this.frameEntryCache.get(frameKey);
    if (frameEntry) {
      return this.readUopFrames(frameEntry.spec, frameEntry.entry, uopAction, direction, type, hue, partial);
    }

    const primary = this.readMulAt(fileIndex, graphic, type, action, direction, hue, partial);
    if (primary.length || equip) return primary;

    // Legacy MUL installs often have a bodyconv row pointing at the wrong
    // anim file (Memento's gargoyle 667 exists in anim4, for example), so if
    // the mapped file has no block, try the same graphic/type in every other
    // animation archive before giving up.
    const seen = new Set();
    const candidates = [];
    const add = (index, value, valueType) => {
      if (index < 0 || index >= this.filesMul.length || !this.filesMul[index]) return;
      const key = `${index}|${value}|${valueType}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push([index, value, valueType]);
    };
    add(fileIndex, graphic, type);
    for (let i = 0; i < this.filesMul.length; i++) add(i, graphic, type);
    for (let i = 0; i < this.filesMul.length; i++) add(i, body, type);
    const rawType = this.calcType(body, 0);
    for (let i = 0; i < this.filesMul.length; i++) add(i, body, rawType);
    for (const [index, value, valueType] of candidates) {
      const frames = this.readMulAt(index, value, valueType, action, direction, hue, partial);
      if (frames.length) return frames;
    }
    return this.empty;
  }

  readMulAt(fileIndex, graphic, type, action, direction, hue, partial) {
    const mul = this.filesMul[fileIndex];
    if (!mul || action >= this.actionCount(type)) return this.empty;
    const offset = this.offsetFor(graphic, type) + (action * MAX_DIRECTIONS + direction) * 12;
    if (offset < 0 || offset + 12 > mul.idx.length) return this.empty;
    mul.idx.seek(offset);
    const position = mul.idx.readU32();
    const size = mul.idx.readU32();
    if (!size || position === 0xffffffff || size === 0xffffffff) return this.empty;
    const data = mul.reader.readAt(position, size);
    if (!data || data.length < 512) return this.empty;
    return this.readMulFrames(data, hue, partial);
  }

  readMulFrames(data, hue, partial) {
    const palette = new Uint16Array(256);
    for (let i = 0; i < 256; i++) palette[i] = data.readUInt16LE(i * 2);
    let ptr = 512;
    if (ptr + 4 > data.length) return this.empty;
    const dataStart = ptr;
    const frameCount = data.readUInt32LE(ptr);
    ptr += 4;
    if (frameCount <= 0 || frameCount > 1000) return this.empty;
    const offsets = new Uint32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      offsets[i] = data.readUInt32LE(ptr);
      ptr += 4;
    }
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const frame = readSprite(data, dataStart + offsets[i], palette, false, this.hues, hue, partial);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  readUopFrames(spec, entry, animGroup, direction, type, hue, partial) {
    const buf = this.files.readEntry(spec, entry);
    if (!buf || buf.length < 40) return this.empty;
    let ptr = 32;
    const fc = buf.readInt32LE(ptr);
    ptr += 4;
    const dataStart = buf.readUInt32LE(ptr);
    if (fc <= 0 || fc > 10000 || dataStart >= buf.length) return this.empty;
    ptr = dataStart;

    const raw = [];
    for (let i = 0; i < fc; i++) {
      if (ptr + 16 > buf.length) break;
      const start = ptr;
      const group = buf.readUInt16LE(ptr);
      const frameId = buf.readUInt16LE(ptr + 2);
      ptr += 12;
      const pixelOffset = buf.readUInt32LE(ptr);
      ptr += 4;
      raw.push({ start, group, frameId, pixelOffset });
    }

    const list = [];
    let lastFrameId = 1;
    for (const f of raw) {
      while (f.frameId - lastFrameId > 1) {
        lastFrameId += 1;
        list.push({ start: 0, frameId: lastFrameId });
      }
      list.push(f);
      lastFrameId = f.frameId;
    }

    const realFrameCount = type === 'equipment' ? Math.max(10, Math.round(list.length / MAX_DIRECTIONS)) : Math.round(list.length / MAX_DIRECTIONS);
    if (realFrameCount <= 0) return this.empty;

    const frames = new Array(realFrameCount).fill(null);
    for (const f of list) {
      if (!f.start) continue;
      const frameDirection = Math.floor((f.frameId - 1) / realFrameCount);
      if (frameDirection < direction) continue;
      if (frameDirection > direction) break;
      const idx = (f.frameId - 1) % realFrameCount;
      const paletteStart = f.start + f.pixelOffset;
      if (paletteStart + 512 > buf.length) continue;
      const palette = new Uint16Array(256);
      for (let i = 0; i < 256; i++) palette[i] = buf.readUInt16LE(paletteStart + i * 2);
      frames[idx] = readSprite(buf, paletteStart + 512, palette, true, this.hues, hue, partial);
    }
    return frames.filter((f) => f);
  }
}

function readSprite(buf, offset, palette, alphaCheck, hues, hue, partial) {
  let ptr = offset;
  if (ptr + 8 > buf.length) return null;
  const centerX = buf.readInt16LE(ptr);
  const centerY = buf.readInt16LE(ptr + 2);
  const width = buf.readInt16LE(ptr + 4);
  const height = buf.readInt16LE(ptr + 6);
  ptr += 8;
  if (width <= 0 || height <= 0 || width > 2048 || height > 2048) return null;
  const pixels = new Uint32Array(width * height);
  if (ptr + 4 > buf.length) return null;
  let header = buf.readUInt32LE(ptr);
  ptr += 4;
  let guard = 0;
  while (header !== 0x7fff7fff && ptr <= buf.length && guard++ < 100000) {
    const runLength = header & 0x0fff;
    let x = (header >>> 22) & 0x03ff;
    if (x & 0x0200) x -= 0x400;
    let y = (header >>> 12) & 0x03ff;
    if (y & 0x0200) y -= 0x400;
    x += centerX;
    y += centerY + height;
    let block = y * width + x;
    for (let k = 0; k < runLength; k++) {
      if (ptr >= buf.length) break;
      const val = palette[buf[ptr++]];
      if (block >= 0 && block < pixels.length) {
        if (!alphaCheck || val !== 0) {
          const color = hues.getColor16(val, hue, partial);
          pixels[block] = (255 << 24) | color16To32(color);
        }
      }
      block++;
    }
    if (ptr + 4 > buf.length) break;
    header = buf.readUInt32LE(ptr);
    ptr += 4;
  }
  return { centerX, centerY, width, height, pixels };
}
