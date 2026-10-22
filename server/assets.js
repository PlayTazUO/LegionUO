import crypto from 'node:crypto';
import fs from 'node:fs';
import { applyBlackTransparency, encodePNG } from './lib/png.js';
import { UOFileManager } from './uo/files.js';
import { HueManager } from './uo/hues.js';
import { ArtManager } from './uo/art.js';
import { GumpsManager } from './uo/gumps.js';
import { MapManager, MAP_SIZES } from './uo/map.js';
import { TileDataManager } from './uo/tiledata.js';
import { EquipConvManager } from './uo/equipconv.js';
import { TileArtManager } from './uo/tileart.js';
import { AnimationsManager, MAX_DIRECTIONS, MAX_ACTIONS } from './uo/anim.js';
import { ClilocManager } from './uo/cliloc.js';
import { SkillsManager } from './uo/skills.js';
import { MultiManager } from './uo/multi.js';
import { TexmapManager } from './uo/texmaps.js';
import { SoundManager } from './uo/sound.js';
import { FontManager } from './uo/fonts.js';
import { MusicManager } from './uo/music.js';
import { color16ToRgb } from './uo/colors.js';
import { renderFacetCrop } from './uo/multimap.js';

class LRU {
  constructor(limitBytes) {
    this.limit = limitBytes;
    this.map = new Map();
    this.size = 0;
  }

  get(key) {
    const value = this.map.get(key);
    if (!value) return null;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  static sizeOf(value) {
    if (value == null) return 0;
    if (Array.isArray(value)) return 4096 + value.length * 64;
    if (typeof value.length === 'number') return value.length;
    if (value.png?.length) return value.png.length + 4096;
    if (value.data?.length) return value.data.length + 4096;
    if (Array.isArray(value.cells)) {
      return (
        2048 +
        value.cells.length * 64 +
        (value.statics?.length || 0) * 96 +
        (value.land?.length || 0) * 2 +
        (value.staticsRaw?.length || 0) * 2
      );
    }
    return 4096;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.size -= LRU.sizeOf(this.map.get(key));
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.size += LRU.sizeOf(value);
    this.trim();
  }

  setLimit(limitBytes) {
    this.limit = Math.max(0, limitBytes);
    this.trim();
  }

  trim() {
    while (this.size > this.limit && this.map.size > 1) {
      const [oldKey, oldValue] = this.map.entries().next().value;
      this.map.delete(oldKey);
      this.size -= LRU.sizeOf(oldValue);
    }
  }

  stats() {
    return { entries: this.map.size, bytes: this.size, limit: this.limit };
  }
}

const TRANSPARENT_PNG = encodePNG(1, 1, new Uint32Array(1));

function assetServerId(config) {
  const seed = [
    config.uoDir || '',
    config.clientVersion || '',
    config.mapCount || '',
    config.language || '',
  ].join('\n');
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

export class AssetService {
  constructor(config) {
    this.config = config;
    this.serverId = assetServerId(config);
    this.files = new UOFileManager(config.uoDir, config);
    this.initManagers();
  }

  initManagers() {
    const config = this.config;
    this.hues = new HueManager(this.files);
    this.tiledata = new TileDataManager(this.files, config.clientVersion);
    this.art = new ArtManager(this.files, this.hues);
    this.texmaps = new TexmapManager(this.files, this.hues);
    this.gumps = new GumpsManager(this.files, this.hues);
    this.maps = new MapManager(this.files, config.mapCount || 6);
    this.equipconv = new EquipConvManager(this.files);
    this.tileart = new TileArtManager(this.files);
    this.animations = new AnimationsManager(this.files, this.hues);
    this.clilocs = new ClilocManager(this.files, config.language || 'enu');
    this.skills = new SkillsManager(this.files);
    this.multis = new MultiManager(this.files, config.clientVersion);
    this.sounds = new SoundManager(this.files);
    this.fonts = new FontManager(this.files, this.hues);
    this.music = new MusicManager(this.files);
    this.cache = new LRU((config.cacheMb || 256) * 1024 * 1024);
    this.radarBuffer = undefined;

    for (let i = 0; i < this.maps.mapCount; i++) {
      const [w, h] = MAP_SIZES[i] || MAP_SIZES[0];
      this.maps.sizes[i] = [w, h];
    }
  }

  setDir(dir) {
    this.config.uoDir = dir;
    this.serverId = assetServerId(this.config);
    this.files.setDir(dir);
    this.initManagers();
  }

  setCacheLimit(mb) {
    const value = Number(mb);
    this.cache.setLimit((Number.isFinite(value) && value >= 0 ? value : 256) * 1024 * 1024);
  }

  info() {
    const has = (name) => this.files.has(name);
    const artUop = has('artLegacyMUL.uop');
    const artMul = has('art.mul');
    const gumpUop = has('gumpartLegacyMUL.uop');
    const gumpMul = has('gumpart.mul');
    const clilocName = `Cliloc.${this.config.language || 'enu'}`;
    return {
      serverId: this.serverId,
      uoDir: this.config.uoDir,
      clientVersion: this.config.clientVersion,
      maps: this.maps.sizes,
      mapCount: this.maps.mapCount,
      files: {
        artUop,
        artMul,
        art: artUop || artMul,
        gumpUop,
        gumpMul,
        gumps: gumpUop || gumpMul,
        tiledata: has('tiledata.mul'),
        texmaps: has('texmaps.mul') && has('texidx.mul'),
        hues: has('hues.mul'),
        cliloc: has(clilocName) || has('Cliloc.enu'),
        animMul: has('anim.mul'),
        animUop: has('AnimationFrame1.uop'),
        anim: has('AnimationFrame1.uop') || has('anim.mul'),
        map0: has('map0.mul') || has('map0LegacyMUL.uop'),
        staidx0: has('staidx0.mul'),
        multi: has('multi.mul') || has('MultiCollection.uop'),
        sound: has('sound.mul') || has('soundLegacyMUL.uop'),
        fonts: has('fonts.mul'),
        music: has('Music/Digital/Config.txt') || has('Music/Config.txt'),
        skills: has('skills.mul') || has('Skills.mul'),
        radar: has('radarcol.mul'),
        facets: has('facet00.mul') || has('facet0.mul'),
      },
      paths: {
        art: this.files.find('artLegacyMUL.uop') || this.files.find('art.mul'),
        gumps: this.files.find('gumpartLegacyMUL.uop') || this.files.find('gumpart.mul'),
        tiledata: this.files.find('tiledata.mul'),
        texmaps: this.files.find('texmaps.mul') || this.files.find('texidx.mul'),
        hues: this.files.find('hues.mul'),
        cliloc: this.files.find(clilocName) || this.files.find('Cliloc.enu'),
        anim: this.files.find('AnimationFrame1.uop') || this.files.find('anim.mul'),
        map0: this.files.find('map0LegacyMUL.uop') || this.files.find('map0.mul'),
        multi: this.files.find('MultiCollection.uop') || this.files.find('multi.mul'),
        sound: this.files.find('sound.mul') || this.files.find('soundLegacyMUL.uop'),
        fonts: this.files.find('fonts.mul'),
        music: this.files.find('Music/Digital/Config.txt') || this.files.find('Music/Config.txt'),
        skills: this.files.find('skills.mul') || this.files.find('Skills.mul'),
        radar: this.files.find('radarcol.mul'),
        facet0: this.files.find('facet00.mul') || this.files.find('facet0.mul'),
      },
      hues: (() => {
        try {
          return this.hues.count;
        } catch {
          return 0;
        }
      })(),
    };
  }

  cacheKey(key) {
    return `${this.serverId}|${key}`;
  }

  pngCache(key, producer) {
    const cacheKey = this.cacheKey(key);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const png = producer() || TRANSPARENT_PNG;
    this.cache.set(cacheKey, png);
    return png;
  }

  artLand(id, hue, partial) {
    // Land graphics are their own tiledata rows; when the caller does not say,
    // let the tile's PartialHue flag decide.
    const usePartial = partial == null ? this.tiledata.isPartialHue(id, true) : !!partial;
    return this.pngCache(`land|${id}|${hue}|${usePartial ? 1 : 0}`, () => {
      const img = this.art.getLand(id, hue, usePartial);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, img.pixels);
    });
  }

  artStatic(id, hue, partial) {
    // Item art carries the hue in two halves: the graphic supplies the mask
    // (which texels are grey) and the tiledata flag says whether to use it.
    const usePartial = partial == null ? this.tiledata.isPartialHue(id, false) : !!partial;
    return this.pngCache(`static|${id}|${hue}|${usePartial ? 1 : 0}`, () => {
      const img = this.art.getStatic(id, hue, usePartial);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, applyBlackTransparency(img.pixels));
    });
  }

  texmap(id, hue, partial = false) {
    return this.pngCache(`texmap|${id}|${hue}|${partial ? 1 : 0}`, () => {
      const img = this.texmaps.get(id, hue, partial);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, img.pixels);
    });
  }

  gump(id, hue, partial = false) {
    return this.pngCache(`gump|${id}|${hue}|${partial ? 1 : 0}`, () => {
      const img = this.gumps.get(id, hue, partial);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, applyBlackTransparency(img.pixels));
    });
  }

  animation(body, action, direction, hue, equip = false, partial = false) {
    const key = this.cacheKey(
      `anim|${body}|${action}|${direction}|${hue}|${equip ? 'e' : ''}|${partial ? 'p' : ''}`
    );
    const cached = this.cache.get(key);
    if (cached) return cached;
    const frames = this.animations.getFrames(body, action, direction, hue, equip, partial) || [];
    const type = this.animations.resolve(body).type;
    if (!frames.length) {
      const result = { meta: { frames: [], sheet: { width: 0, height: 0 }, type }, png: TRANSPARENT_PNG };
      this.cache.set(key, result);
      return result;
    }
    let sheetWidth = 0;
    let sheetHeight = 0;
    for (const f of frames) {
      sheetWidth += f.width;
      sheetHeight = Math.max(sheetHeight, f.height);
    }
    const sheet = new Uint32Array(sheetWidth * sheetHeight);
    let x = 0;
    const meta = [];
    for (const f of frames) {
      for (let y = 0; y < f.height; y++) {
        const src = y * f.width;
        const dst = y * sheetWidth + x;
        sheet.set(f.pixels.subarray(src, src + f.width), dst);
      }
      meta.push({ x, y: 0, w: f.width, h: f.height, cx: f.centerX, cy: f.centerY });
      x += f.width;
    }
    const result = {
      meta: { frames: meta, sheet: { width: sheetWidth, height: sheetHeight }, type },
      png: encodePNG(sheetWidth, sheetHeight, applyBlackTransparency(sheet)),
    };
    this.cache.set(key, result);
    return result;
  }

  mapBlock(map, bx, by, useXFiles = false) {
    const key = this.cacheKey(`mapblock|${map}|${bx}|${by}|${useXFiles ? 'x' : ''}`);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const block = this.maps.getBlock(map, bx, by, useXFiles);
    if (block) this.cache.set(key, block);
    return block;
  }

  musicTrack(index) {
    const key = this.cacheKey(`music|${index}`);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const track = this.music.get(index);
    if (track) this.cache.set(key, track);
    return track;
  }

  font(font, hue) {
    return this.fonts.atlas(font, hue);
  }

  sound(id) {
    const key = this.cacheKey(`sound|${id}`);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const data = this.sounds.get(id);
    if (data) this.cache.set(key, data);
    return data;
  }

  multi(id) {
    const key = this.cacheKey(`multi|${id}`);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const parts = this.multis.get(id);
    this.cache.set(key, parts);
    return parts;
  }

  radarColors() {
    if (this.radarBuffer !== undefined) return this.radarBuffer;
    const file = this.files.find('radarcol.mul');
    this.radarBuffer = file ? fs.readFileSync(file) : null;
    return this.radarBuffer;
  }

  mapImage(facet, x0, y0, x1, y1, width, height) {
    if (!Number.isFinite(facet) || facet < 0) return null;
    const key = this.cacheKey(`mapimage|${facet}|${x0}|${y0}|${x1}|${y1}|${width}|${height}`);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const png = renderFacetCrop(this.files, Math.floor(facet), x0, y0, x1, y1, width, height);
    if (png) this.cache.set(key, png);
    return png;
  }

  tiledataJSON(withNames = false) {
    const key = this.cacheKey(`tiledata|${withNames}`);
    const cached = this.cache.get(key);
    if (cached) return cached;
    this.tiledata.load();
    const data = withNames
      ? {
          land: this.tiledata.land.map((t) => [t.flags, t.textId, t.name]),
          statics: this.tiledata.statics.map((t) => [t.flags, t.height, t.layer, t.animId, t.name]),
        }
      : {
          land: this.tiledata.land.map((t) => [t.flags, t.textId]),
          statics: this.tiledata.statics.map((t) => [t.flags, t.height, t.layer, t.animId]),
        };
    const buf = Buffer.from(JSON.stringify(data));
    this.cache.set(key, buf);
    return buf;
  }

  tileArtAppearances(id) {
    return this.tileart.get(id);
  }

  equipConvJSON() {
    const key = this.cacheKey('equipconv');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const buf = Buffer.from(JSON.stringify(this.equipconv.toJSON()));
    this.cache.set(key, buf);
    return buf;
  }

  skillsJSON() {
    const key = this.cacheKey('skills');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const buf = Buffer.from(JSON.stringify(this.skills.toJSON()));
    this.cache.set(key, buf);
    return buf;
  }

  hueInfo() {
    const key = this.cacheKey('hues');
    const cached = this.cache.get(key);
    if (cached) return cached;
    this.hues.load();
    const text = [];
    const count = this.hues.count;
    for (let i = 0; i < count; i++) {
      const c = this.hues.getTextColor(i + 1);
      const [r, g, b] = color16ToRgb(c);
      text.push((r << 16) | (g << 8) | b);
    }
    const info = { count, text };
    this.cache.set(key, info);
    return info;
  }

  cacheStats() {
    return this.cache.stats();
  }
}
