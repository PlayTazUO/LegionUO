import fs from 'node:fs';
import { applyBlackTransparency, encodePNG } from './lib/png.js';
import { UOFileManager } from './uo/files.js';
import { HueManager } from './uo/hues.js';
import { ArtManager } from './uo/art.js';
import { GumpsManager } from './uo/gumps.js';
import { MapManager, MAP_SIZES } from './uo/map.js';
import { TileDataManager } from './uo/tiledata.js';
import { AnimationsManager, MAX_DIRECTIONS, MAX_ACTIONS } from './uo/anim.js';
import { ClilocManager } from './uo/cliloc.js';
import { SkillsManager } from './uo/skills.js';
import { MultiManager } from './uo/multi.js';
import { TexmapManager } from './uo/texmaps.js';
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
    if (typeof value.length === 'number') return value.length;
    if (value.png?.length) return value.png.length + 4096;
    return 4096;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.size -= LRU.sizeOf(this.map.get(key));
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.size += LRU.sizeOf(value);
    while (this.size > this.limit && this.map.size > 1) {
      const [oldKey, oldValue] = this.map.entries().next().value;
      this.map.delete(oldKey);
      this.size -= LRU.sizeOf(oldValue);
    }
  }
}

const TRANSPARENT_PNG = encodePNG(1, 1, new Uint32Array(1));

export class AssetService {
  constructor(config) {
    this.config = config;
    this.files = new UOFileManager(config.uoDir, config);
    this.hues = new HueManager(this.files);
    this.art = new ArtManager(this.files, this.hues);
    this.texmaps = new TexmapManager(this.files, this.hues);
    this.gumps = new GumpsManager(this.files, this.hues);
    this.maps = new MapManager(this.files, config.mapCount || 6);
    this.tiledata = new TileDataManager(this.files, config.clientVersion);
    this.animations = new AnimationsManager(this.files, this.hues);
    this.clilocs = new ClilocManager(this.files, config.language || 'enu');
    this.skills = new SkillsManager(this.files);
    this.multis = new MultiManager(this.files, config.clientVersion);
    this.cache = new LRU((config.cacheMb || 256) * 1024 * 1024);
    this.radarBuffer = undefined;

    for (let i = 0; i < this.maps.mapCount; i++) {
      const [w, h] = MAP_SIZES[i] || MAP_SIZES[0];
      this.maps.sizes[i] = [w, h];
    }
  }

  setDir(dir) {
    this.files.setDir(dir);
    this.hues = new HueManager(this.files);
    this.art = new ArtManager(this.files, this.hues);
    this.texmaps = new TexmapManager(this.files, this.hues);
    this.gumps = new GumpsManager(this.files, this.hues);
    this.maps = new MapManager(this.files, this.config.mapCount || 6);
    this.tiledata = new TileDataManager(this.files, this.config.clientVersion);
    this.animations = new AnimationsManager(this.files, this.hues);
    this.clilocs = new ClilocManager(this.files, this.config.language || 'enu');
    this.skills = new SkillsManager(this.files);
    this.multis = new MultiManager(this.files, this.config.clientVersion);
    this.cache = new LRU((this.config.cacheMb || 256) * 1024 * 1024);
    this.radarBuffer = undefined;
  }

  info() {
    const has = (name) => this.files.has(name);
    const artUop = has('artLegacyMUL.uop');
    const artMul = has('art.mul');
    const gumpUop = has('gumpartLegacyMUL.uop');
    const gumpMul = has('gumpart.mul');
    const clilocName = `Cliloc.${this.config.language || 'enu'}`;
    return {
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

  pngCache(key, producer) {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const png = producer() || TRANSPARENT_PNG;
    this.cache.set(key, png);
    return png;
  }

  artLand(id, hue) {
    return this.pngCache(`land|${id}|${hue}`, () => {
      const img = this.art.getLand(id, hue);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, img.pixels);
    });
  }

  artStatic(id, hue) {
    return this.pngCache(`static|${id}|${hue}`, () => {
      const img = this.art.getStatic(id, hue);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, applyBlackTransparency(img.pixels));
    });
  }

  texmap(id, hue) {
    return this.pngCache(`texmap|${id}|${hue}`, () => {
      const img = this.texmaps.get(id, hue);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, img.pixels);
    });
  }

  gump(id, hue) {
    return this.pngCache(`gump|${id}|${hue}`, () => {
      const img = this.gumps.get(id, hue);
      if (!img || !img.width) return TRANSPARENT_PNG;
      return encodePNG(img.width, img.height, applyBlackTransparency(img.pixels));
    });
  }

  animation(body, action, direction, hue) {
    const key = `anim|${body}|${action}|${direction}|${hue}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const frames = this.animations.getFrames(body, action, direction, hue) || [];
    if (!frames.length) {
      const result = { meta: { frames: [], sheet: { width: 0, height: 0 } }, png: TRANSPARENT_PNG };
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
      meta: { frames: meta, sheet: { width: sheetWidth, height: sheetHeight } },
      png: encodePNG(sheetWidth, sheetHeight, applyBlackTransparency(sheet)),
    };
    this.cache.set(key, result);
    return result;
  }

  mapBlock(map, bx, by) {
    return this.maps.getBlock(map, bx, by);
  }

  radarColors() {
    if (this.radarBuffer !== undefined) return this.radarBuffer;
    const file = this.files.find('radarcol.mul');
    this.radarBuffer = file ? fs.readFileSync(file) : null;
    return this.radarBuffer;
  }

  mapImage(facet, x0, y0, x1, y1, width, height) {
    if (!Number.isFinite(facet) || facet < 0) return null;
    const key = `mapimage|${facet}|${x0}|${y0}|${x1}|${y1}|${width}|${height}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const png = renderFacetCrop(this.files, Math.floor(facet), x0, y0, x1, y1, width, height);
    if (png) this.cache.set(key, png);
    return png;
  }

  tiledataJSON(withNames = false) {
    const key = `tiledata|${withNames}`;
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

  hueInfo() {
    this.hues.load();
    const text = [];
    const count = this.hues.count;
    for (let i = 0; i < count; i++) {
      const c = this.hues.getTextColor(i + 1);
      const [r, g, b] = color16ToRgb(c);
      text.push((r << 16) | (g << 8) | b);
    }
    return { count, text };
  }
}
