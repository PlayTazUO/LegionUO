import {
  Layer,
  animDirection,
  baseBodyGraphic,
  buildEquipmentOrder,
  isFemaleMobile,
  isGargoyleBody,
} from './entity.js';
import { hasUoHtmlMarkup, drawServerText, measureUoHtml } from './html.js';
import { MOUNTS } from './mounts.js';
import { settings } from './settings.js';
import { notorietyColor } from '../util/ui.js';

const ANIM_FRAME_MS = 80;
const CORPSE_Z_BUMP = 1;
const CULL_PAD = 80;
const MAX_OBJECT_Z = 127;
const MIN_OBJECT_Z = -128;
const TRANSPARENT_FLAG = 0x00000004;
const FOLIAGE_FLAG = 0x00020000;
const ROOF_FLAG = 0x10000000;
// UO's flat land art (land.mul) is pre-shaded for the isometric key light, so
// a raw texmap drawn on a slope reads ~15% brighter. ClassicUO compensates
// with get_light(normal); for a flat tile that evaluates to 0.5 + cos(45)/2.
const LAND_LIGHT = 0.5 + Math.SQRT1_2 / 2;

const GARGOYLE_EQUIPMENT = new Map([
  [0x01d5, 0x0156],
  [0x03ca, 0x0223],
  [0x03d8, 329],
  [0x0372, 330],
  [0x0374, 328],
  [0x036f, 327],
  [0x036e, 328],
  [0x0426, 0x042b],
  [1529, 1531],
  [1530, 1532],
]);

export class Renderer {
  constructor(canvas, world, assets, effects, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.assets = assets;
    this.effects = effects;
    this.game = game;
    this.camera = { x: 0, y: 0 };
    this.mouse = { x: 0, y: 0, world: { x: 0, y: 0 } };
    this.landTileCache = new Map();
    this.landTileCacheBytes = 0;
    this.landTileCacheLimit = 16 * 1024 * 1024;
    this.overheadCache = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, Math.round(parent?.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(parent?.clientHeight || window.innerHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.dpr = dpr;
    this.width = width;
    this.height = height;
  }

  playerScreen() {
    const p = this.world.player;
    if (!p) return { x: 0, y: 0 };
    return { x: (p.renderX - p.renderY) * 22, y: (p.renderX + p.renderY) * 22 - p.renderZ * 4 };
  }

  updateCamera() {
    const ps = this.playerScreen();
    this.camera.x = ps.x - this.width / 2;
    this.camera.y = ps.y - this.height / 2;
  }

  tileRange() {
    // Screen axes are isometric: lateral = x - y, depth = x + y. High-z
    // objects shift up the screen, so the depth range has to grow with z or
    // roofs and other tall statics on nearer tiles get culled before they
    // reach the viewport.
    const pad = CULL_PAD;
    const lateral = Math.ceil((this.width / 2 + pad) / 22);
    const depth = Math.ceil((this.height / 2 + pad) / 22) + 1;
    const pz = this.world.player?.z || 0;
    const front = Math.ceil((Math.max(0, MAX_OBJECT_Z - pz) * 4) / 22);
    const back = Math.ceil((Math.max(0, pz - MIN_OBJECT_Z) * 4) / 22);
    return { lateral, depthFront: depth + front, depthBack: depth + back };
  }

  screenFor(x, y, z = 0) {
    return {
      sx: (x - y) * 22 - 22 - this.camera.x,
      sy: (x + y) * 22 - z * 4 - 22 - this.camera.y,
    };
  }

  staticDrawPos(x, y, z, img) {
    const p = this.screenFor(x, y, z);
    return {
      x: p.sx - (img.width >> 1) + 22,
      y: p.sy - img.height + 44,
    };
  }

  imageVisible(x, y, width, height) {
    return x + width >= 0 && x <= this.width && y + height >= 0 && y <= this.height;
  }

  priorityZ(z, graphic) {
    const flags = (this.assets.staticFlags(graphic) || 0) >>> 0;
    let priority = z;
    if (flags & 0x00000001) priority--;
    if ((this.assets.staticHeight(graphic) || 0) !== 0) priority++;
    return priority;
  }

  overheadState() {
    // When the player is inside a building, the first floor/roof above their
    // head becomes a cut plane: nothing at or above it is drawn. That keeps
    // upper stories and roofs from covering the room the player is standing in.
    // Roof-flagged art is also hidden as a whole: roof sprites extend well past
    // their base z, so tall/sloped roofs would otherwise still cover the view
    // from neighbouring tiles even when their base sits below the cut plane.
    const player = this.world.player;
    if (!player) return { cut: Infinity, hideRoofs: false };
    const x = Math.floor(player.x);
    const y = Math.floor(player.y);
    const z = player.z | 0;
    const block = this.world.getBlock(x >> 3, y >> 3);
    const cached = this.overheadCache;
    if (
      cached &&
      cached.block === block &&
      cached.x === x &&
      cached.y === y &&
      cached.z === z &&
      cached.multiVersion === this.world.multiVersion
    ) {
      return cached;
    }

    let cut = Infinity;
    let hideRoofs = false;
    const headZ = z + 14;

    const consider = (tileZ, graphic) => {
      const flags = (this.assets.staticFlags(graphic) || 0) >>> 0;
      // Standing under any roof piece means roofs should not be drawn, even
      // pieces whose base z is below the cut plane or below head height.
      if (flags & ROOF_FLAG) {
        if (tileZ > z) hideRoofs = true;
      }
      if (tileZ <= headZ || tileZ >= cut) return;
      // Transparent and foliage tiles should not create a cut plane.
      if (flags & TRANSPARENT_FLAG || flags & FOLIAGE_FLAG) return;
      if (this.assets.isNoDraw(graphic, false)) return;
      cut = tileZ;
      hideRoofs = true;
    };

    if (block) {
      for (const s of this.world.staticsAt(block, x & 7, y & 7)) consider(s.z, s.graphic);
    }

    // Player houses and other multis keep their floors and roofs in the multi
    // definition rather than map statics, so check the parts covering the
    // player's tile as well.
    let pendingMulti = false;
    for (const e of this.world.entities.values()) {
      if (!e.isItem || e.container !== 0 || !e.hasPosition) continue;
      if (e.isMulti) {
        const dx = x - e.x;
        const dy = y - e.y;
        if (Math.abs(dx) > 32 || Math.abs(dy) > 32) continue;
        const parts = this.world.multiParts(e);
        if (!parts) {
          pendingMulti = true;
          continue;
        }
        for (const part of parts) {
          if (!part.visible || part.x !== dx || part.y !== dy) continue;
          consider(e.z + part.z, part.graphic);
        }
      } else if (e.x === x && e.y === y) {
        consider(e.z, e.graphic);
      }
    }

    const state = { x, y, z, block, cut, hideRoofs, multiVersion: this.world.multiVersion };
    // Re-scan until every multi around the player has loaded its parts.
    this.overheadCache = pendingMulti ? null : state;
    return state;
  }

  mobileSortKey(mobile) {
    const x = mobile.renderX ?? mobile.x;
    const y = mobile.renderY ?? mobile.y;
    const depth = Math.ceil(x + y - 1e-6);
    const tileX = Math.ceil(x - 1e-6);
    return `${tileX},${depth - tileX}`;
  }

  screenToTile(mx, my) {
    const wx = mx + this.camera.x;
    const wy = my + this.camera.y;
    const x = (wx / 22 + wy / 22) / 2;
    const y = (wy / 22 - wx / 22) / 2;
    return { x: Math.round(x), y: Math.round(y) };
  }

  draw(now) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.world.player) return;

    this.updateCamera();
    const range = this.tileRange();
    const px = this.world.player.x;
    const py = this.world.player.y;
    const reach = Math.max(range.lateral, range.depthFront, range.depthBack);
    this.world.ensureMapAround(px, py, Math.ceil(reach / 8) + 1);

    const overhead = this.overheadState();
    const cutZ = overhead.cut;
    const groundItems = new Map();
    const mobiles = new Map();
    for (const e of this.world.entities.values()) {
      if (e.isMobile) {
        if (!e.isDead || e.isCorpse || e.isGhost) {
          const key = this.mobileSortKey(e);
          if (!mobiles.has(key)) mobiles.set(key, []);
          mobiles.get(key).push(e);
        }
      } else if (e.container === 0 && e.serial !== this.world.playerSerial) {
        if (e.isMulti) {
          // Multi parts are spread over their own tiles so floors, walls and
          // roofs sort with everything else in the isometric depth pass.
          // Custom houses use the 0xD8 design instead of the base multi.
          const parts = this.world.multiParts(e);
          if (!parts) continue;
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part.visible) continue;
            const key = `${e.x + part.x},${e.y + part.y}`;
            if (!groundItems.has(key)) groundItems.set(key, []);
            groundItems.get(key).push({ entity: e, part, order: i });
          }
          continue;
        }
        const key = `${e.x},${e.y}`;
        if (!groundItems.has(key)) groundItems.set(key, []);
        groundItems.get(key).push(e);
      }
    }

    for (let depth = -range.depthBack; depth <= range.depthFront; depth++) {
      // x + y = depth keeps a stable isometric back-to-front order. Walking
      // the lateral axis (x - y) directly covers the viewport diamond without
      // needing a full square of tiles.
      const aMin = Math.ceil((depth - range.lateral) / 2);
      const aMax = Math.floor((depth + range.lateral) / 2);
      for (let a = aMin; a <= aMax; a++) {
        const x = px + a;
        const y = py + depth - a;
        if (x < 0 || y < 0) continue;
        this.drawTile(ctx, x, y, groundItems, mobiles, now, cutZ, overhead.hideRoofs);
      }
    }

    this.effects.draw(ctx, this.camera, (x, y, z) => {
      const p = this.screenFor(x, y, z);
      return { sx: p.sx + 22, sy: p.sy + 22 };
    });
    this.drawWeather(ctx, now);
    this.drawLighting(ctx);
    this.drawDebugHover(ctx);
    this.drawQuestArrow(ctx);
    this.drawWaypoints(ctx);
  }

  drawTile(ctx, x, y, groundItems, mobiles, now, cutZ = Infinity, hideRoofs = false) {
    const block = this.world.getBlock(x >> 3, y >> 3);
    if (!block) return;
    const lx = x & 7;
    const ly = y & 7;
    const cell = block.cells[(ly << 3) | lx];
    const pos = this.screenFor(x, y, cell.z);
    const groundVisible =
      pos.sx >= -CULL_PAD &&
      pos.sx <= this.width + CULL_PAD &&
      pos.sy >= -CULL_PAD &&
      pos.sy <= this.height + CULL_PAD;

    if (groundVisible && cell.z < cutZ) {
      if (!this.drawStretchedLand(ctx, block, x, y, cell, pos)) {
        const land = this.assets.getLand(cell.tile);
        if (land) ctx.drawImage(land, pos.sx, pos.sy);
      }
    }

    const drawables = [];
    for (const s of this.world.staticGrid(block)[(ly << 3) | lx] || []) {
      if (s.z >= cutZ) continue;
      if (hideRoofs && ((this.assets.staticFlags(s.graphic) || 0) & ROOF_FLAG)) continue;
      drawables.push({ type: 'static', z: s.z, priorityZ: this.priorityZ(s.z, s.graphic), graphic: s.graphic, hue: s.hue });
    }
    for (const item of groundItems.get(`${x},${y}`) || []) {
      if (item.part) {
        const part = item.part;
        const z = item.entity.z + (part.z || 0);
        if (z >= cutZ) continue;
        if (hideRoofs && ((this.assets.staticFlags(part.graphic) || 0) & ROOF_FLAG)) continue;
        drawables.push({
          type: 'multiPart',
          z,
          priorityZ: this.priorityZ(z, part.graphic),
          graphic: part.graphic,
          hue: 0,
          entity: item.entity,
          order: item.order,
        });
        continue;
      }
      if (item.z >= cutZ) continue;
      if (hideRoofs && ((this.assets.staticFlags(item.graphic) || 0) & ROOF_FLAG)) continue;
      const corpse = item.graphic === 0x2006 && this.world.corpses.has(item.serial);
      const z = corpse ? item.z + CORPSE_Z_BUMP : item.z;
      if (z >= cutZ) continue;
      drawables.push({
        type: 'item',
        z,
        priorityZ: this.priorityZ(z, item.graphic),
        graphic: item.graphic,
        hue: item.hue,
        entity: item,
        amount: item.amount,
        corpse,
      });
    }
    for (const m of mobiles.get(`${x},${y}`) || []) {
      if (m.z >= cutZ) continue;
      drawables.push({ type: 'mobile', z: m.z, priorityZ: m.z + 1, entity: m });
    }
    drawables.sort(
      (a, b) =>
        a.priorityZ - b.priorityZ ||
        typeOrder(a) - typeOrder(b) ||
        (a.order ?? 0) - (b.order ?? 0)
    );

    for (const d of drawables) {
      if (d.type === 'mobile') {
        this.drawMobile(ctx, d.entity, now);
      } else if (d.corpse) {
        this.drawCorpse(ctx, d.entity, this.world.corpses.get(d.entity.serial), now, d.z);
      } else {
        const img = this.assets.getStatic(d.graphic, d.hue);
        if (!img) continue;
        const p = this.staticDrawPos(x, y, d.z, img);
        if (!this.imageVisible(p.x, p.y, img.width, img.height)) continue;
        ctx.drawImage(img, p.x, p.y);
        if (d.amount > 1) {
          ctx.fillStyle = '#ffe08a';
          ctx.font = '11px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(String(d.amount), p.x + img.width - 8, p.y + img.height - 14);
        }
      }
    }

    // Overhead names and bars are drawn after the tile's objects.
    for (const m of mobiles.get(`${x},${y}`) || []) {
      if (m.z >= cutZ) continue;
      this.drawMobileText(ctx, m);
    }
  }

  drawStretchedLand(ctx, block, x, y, cell, pos) {
    if (!this.assets.debug && this.assets.isNoDraw(cell.tile, true)) return false;
    const texId = this.assets.landTexId(cell.tile);
    if (!texId) return false;
    const z = cell.z;
    const zRight = this.tileZ(block, x + 1, y, z);
    const zLeft = this.tileZ(block, x, y + 1, z);
    const zBottom = this.tileZ(block, x + 1, y + 1, z);
    const dr = zRight - z;
    const dl = zLeft - z;
    const db = zBottom - z;
    if (!dr && !dl && !db) return false;

    const tex = this.assets.getTexmap(texId);
    if (!tex || tex.width <= 1 || tex.height <= 1) return false;

    const tile = this.landTile(texId, tex, dr, dl, db);
    ctx.drawImage(tile.canvas, pos.sx + tile.x, pos.sy + tile.y, tile.width, tile.height);
    return true;
  }

  landTile(texId, tex, dr, dl, db) {
    const key = `${texId}|${dr}|${dl}|${db}|${this.dpr}`;
    let tile = this.landTileCache.get(key);
    if (tile) {
      this.landTileCache.delete(key);
      this.landTileCache.set(key, tile);
      return tile;
    }

    const pad = 1;
    const rightY = 22 - dr * 4;
    const leftY = 22 - dl * 4;
    const bottomY = 44 - db * 4;
    const minX = -pad;
    const maxX = 44 + pad;
    const minY = Math.min(0, rightY, leftY, bottomY) - pad;
    const maxY = Math.max(0, rightY, leftY, bottomY) + pad;
    const width = Math.max(1, Math.ceil(maxX - minX));
    const height = Math.max(1, Math.ceil(maxY - minY));

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * this.dpr);
    canvas.height = Math.ceil(height * this.dpr);
    const c = canvas.getContext('2d');
    c.scale(this.dpr, this.dpr);

    const ox = -minX;
    const oy = -minY;
    const top = { x: 22 + ox, y: oy };
    const right = { x: 44 + ox, y: rightY + oy };
    const left = { x: ox, y: leftY + oy };
    const bottom = { x: 22 + ox, y: bottomY + oy };
    const w = tex.width;
    const h = tex.height;
    this.drawTexturedTriangle(c, tex, { x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, top, right, left);
    this.drawTexturedTriangle(c, tex, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, right, bottom, left);

    // Darken to the same level as the pre-shaded land art. 'source-atop'
    // keeps the tile's alpha intact so the diamond edge stays transparent.
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = `rgba(0,0,0,${1 - LAND_LIGHT})`;
    c.fillRect(0, 0, width, height);
    c.globalCompositeOperation = 'source-over';

    tile = {
      canvas,
      x: minX,
      y: minY,
      width,
      height,
      bytes: canvas.width * canvas.height * 4,
    };
    this.landTileCache.set(key, tile);
    this.landTileCacheBytes += tile.bytes;
    while (
      this.landTileCache.size > 1 &&
      (this.landTileCacheBytes > this.landTileCacheLimit || this.landTileCache.size > 1024)
    ) {
      const [oldKey, old] = this.landTileCache.entries().next().value;
      this.landTileCache.delete(oldKey);
      this.landTileCacheBytes -= old.bytes;
    }
    return tile;
  }

  drawTexturedTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
    const denom = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (!denom) return;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denom;
    const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denom;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denom;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denom;
    const e = d0.x - a * s0.x - c * s0.y;
    const f = d0.y - b * s0.x - d * s0.y;

    const cx = (d0.x + d1.x + d2.x) / 3;
    const cy = (d0.y + d1.y + d2.y) / 3;
    const expand = (p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * 0.6, y: p.y + (dy / len) * 0.6 };
    };
    const e0 = expand(d0);
    const e1 = expand(d1);
    const e2 = expand(d2);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.beginPath();
    ctx.moveTo(e0.x, e0.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.lineTo(e2.x, e2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  tileZ(block, x, y, fallback = 0) {
    const bx = x >> 3;
    const by = y >> 3;
    const source = bx === block.bx && by === block.by ? block : this.world.getBlock(bx, by);
    if (!source) return fallback;
    const cell = source.cells[((y & 7) << 3) | (x & 7)];
    return cell ? cell.z : fallback;
  }

  drawMulti(ctx, item, cutZ = Infinity, hideRoofs = false) {
    const parts = this.world.multiParts(item);
    if (!parts) return;
    for (const part of parts) {
      if (!part.visible) continue;
      if (item.z + part.z >= cutZ) continue;
      if (hideRoofs && ((this.assets.staticFlags(part.graphic) || 0) & ROOF_FLAG)) continue;
      const img = this.assets.getStatic(part.graphic, 0);
      if (!img) continue;
      const p = this.staticDrawPos(item.x + part.x, item.y + part.y, item.z + part.z, img);
      ctx.drawImage(img, p.x, p.y);
    }
  }

  drawCorpse(ctx, item, corpse, now, z = item.z) {
    const type = this.game.getAnimType(corpse.graphic);
    const group = type === 'people' ? 21 : type === 'low' ? 8 : 2;
    const { dir, mirror } = animDirection(corpse.direction || 0);
    const animData = this.assets.getAnim(corpse.graphic, group, dir, corpse.hue || 0);
    if (!animData || !animData.meta.frames.length) {
      const img = this.assets.getStatic(0x2006, 0);
      if (img) {
        const p = this.staticDrawPos(item.x, item.y, z, img);
        ctx.drawImage(img, p.x, p.y);
      }
      return;
    }
    const frames = animData.meta.frames;
    const f = frames[frames.length - 1];
    const p = this.screenFor(item.x, item.y, z);
    this.drawAnimFrame(ctx, animData, f, p.sx + 22, p.sy + 22, mirror, 1);
  }

  mobileMount(mobile) {
    return mobile?.mount || mobile?.getItem?.(Layer.Mount) || null;
  }

  mobileAnimGroups(mobile) {
    const type = this.game.getAnimType(mobile.graphic);
    if (type === 'people') {
      if (this.mobileMount(mobile) && !mobile.isDead) {
        // TazUO's PeopleAnimationGroup: OnmountStand/RideSlow/RideFast.
        return { type, idleGroup: 25, walkGroup: 23, runGroup: 24 };
      }
      return {
        type,
        idleGroup: mobile.inWarMode && !mobile.isDead ? 7 : 4,
        walkGroup: mobile.inWarMode ? 15 : 0,
        runGroup: mobile.getItem(Layer.TwoHanded) ? 3 : 2,
      };
    }
    if (type === 'low') {
      return { type, idleGroup: 2, walkGroup: 0, runGroup: 1 };
    }
    return { type, idleGroup: 1, walkGroup: 0, runGroup: 0 };
  }

  mountGraphics(mount) {
    if (!mount) return null;
    const known = MOUNTS.get(mount.graphic);
    const animId = known?.graphic || this.assets.staticAnimId(mount.graphic) || mount.graphic;
    if (!animId) return null;
    return { animId, offsetY: known?.offsetY || 0, hue: mount.hue || 0 };
  }

  mountAnimGroups(animId) {
    const type = this.assets.animType(animId) || this.game.getAnimType(animId);
    if (type === 'low') return { idleGroup: 2, walkGroup: 0, runGroup: 1 };
    if (type === 'high') return { idleGroup: 1, walkGroup: 0, runGroup: 0 };
    return { idleGroup: 4, walkGroup: 0, runGroup: 2 };
  }

  drawMobile(ctx, mobile, now) {
    const { type, idleGroup, walkGroup, runGroup } = this.mobileAnimGroups(mobile);
    const mount = type === 'people' && !mobile.isDead ? this.mountGraphics(this.mobileMount(mobile)) : null;
    const anim = mobile.animation;
    const sinceStart = now - (anim?.start || 0);
    const serverPlaying = anim?.fromServer && sinceStart < Math.max(400, (anim.frameCount || 5) * ANIM_FRAME_MS);
    const running = !!mobile.running;

    const gameDir = mobile.direction & 7;
    const { dir, mirror } = animDirection(gameDir);
    const gargoyle = isGargoyleBody(mobile.graphic);
    const equipmentLayers =
      type === 'people'
        ? buildEquipmentOrder(mobile, this.assets, {
            direction: gameDir,
            altTorso: isFemaleMobile(mobile) || gargoyle,
          })
        : [];
    const previous = mobile.animRender;
    if (previous && previous.gameDir !== gameDir && previous.walking) {
      // A turn interrupts the next step by a few frames. Hold the walk group
      // through that gap instead of flashing idle and restarting at frame 0.
      mobile.turnAnimGraceUntil = now + 150;
    }
    const turning = (mobile.turnAnimGraceUntil || 0) > now;
    const walking = mobile.moving || turning;

    let group;
    if (serverPlaying) group = anim.group;
    else if (walking) group = running ? runGroup : walkGroup;
    else group = idleGroup;

    // Warm the cache for the group we are about to switch to, so the first
    // idle <-> walk <-> run transition does not have to wait on a fetch.
    const prefetchGroup = walking ? idleGroup : walkGroup;
    this.assets.getAnim(mobile.graphic, prefetchGroup, dir, mobile.hue || 0);
    if (runGroup !== walkGroup) {
      this.assets.getAnim(mobile.graphic, runGroup, dir, mobile.hue || 0);
    }
    if (mount) {
      const mg = this.mountAnimGroups(mount.animId);
      this.assets.getAnim(mount.animId, mg.idleGroup, dir, mount.hue);
      this.assets.getAnim(mount.animId, mg.walkGroup, dir, mount.hue);
      if (mg.runGroup !== mg.walkGroup) this.assets.getAnim(mount.animId, mg.runGroup, dir, mount.hue);
    }
    if (type === 'people' && !mobile.isGhost && this.assets.tileData) {
      for (const layer of equipmentLayers) {
        const item = mobile.getItem(layer);
        if (!item) continue;
        const equipment = this.equipmentGraphics(mobile, item, gargoyle);
        if (equipment) {
          this.assets.getAnim(
            equipment.animId,
            prefetchGroup,
            dir,
            equipment.hue,
            true,
            equipment.partial
          );
        }
      }
    }
    // The player turns constantly; load the body for every isometric
    // direction up front so turning does not flash the sprite.
    if (mobile === this.world.player) {
      const key = `${mobile.graphic}|${mobile.hue}|${idleGroup}|${walkGroup}|${runGroup}`;
      if (mobile.prefetchKey !== key) {
        mobile.prefetchKey = key;
        for (let d = 0; d < 5; d++) {
          this.assets.getAnim(mobile.graphic, idleGroup, d, mobile.hue || 0);
          this.assets.getAnim(mobile.graphic, walkGroup, d, mobile.hue || 0);
          if (runGroup !== walkGroup) this.assets.getAnim(mobile.graphic, runGroup, d, mobile.hue || 0);
        }
      }
    }

    const animData = this.assets.getAnim(mobile.graphic, group, dir, mobile.hue || 0);
    const pos = this.screenFor(mobile.renderX, mobile.renderY, mobile.renderZ);
    pos.sx += 22;
    pos.sy += 22;
    let spriteTop = Infinity;

    if (mount) {
      const mg = this.mountAnimGroups(mount.animId);
      const mountGroup = walking ? (running ? mg.runGroup : mg.walkGroup) : mg.idleGroup;
      const mountAnim = this.assets.getAnim(mount.animId, mountGroup, dir, mount.hue);
      if (mountAnim && mountAnim.meta.frames.length) {
        const frames = mountAnim.meta.frames;
        let index = this.animFrameIndex(mobile, anim, frames.length, sinceStart, serverPlaying, now, walking);
        index = Math.min(index, frames.length - 1);
        const top = this.drawAnimFrame(ctx, mountAnim, frames[index], pos.sx, pos.sy, mirror, 1);
        if (top != null) spriteTop = Math.min(spriteTop, top);
      }
      pos.sy += mount.offsetY;
    }

    let drewBody = false;
    let bodyFrame = null;
    if (animData && animData.meta.frames.length) {
      const frames = animData.meta.frames;
      const source = this.animFrameSource(mobile, serverPlaying, walking);
      const baseFrame = this.animFrameIndex(mobile, anim, frames.length, sinceStart, serverPlaying, now, walking);
      const frameIndex = this.applyAnimContinuity(mobile, group, dir, baseFrame, frames.length, walking, source);
      bodyFrame = frames[Math.min(frameIndex, frames.length - 1)];
      const top = this.drawAnimFrame(ctx, animData, bodyFrame, pos.sx, pos.sy, mirror, 1);
      if (top != null) spriteTop = Math.min(spriteTop, top);
      drewBody = true;
    } else if (mobile.lastFrameSet?.body) {
      // Keep the last loaded frame visible while the new group/direction loads.
      const last = mobile.lastFrameSet;
      const top = this.drawAnimFrame(ctx, last.body.data, last.body.frame, pos.sx, pos.sy, last.body.mirror, 1);
      if (top != null) spriteTop = Math.min(spriteTop, top);
      for (const entry of last.equipment) {
        const entryTop = this.drawAnimFrame(ctx, entry.data, entry.frame, pos.sx, pos.sy, entry.mirror, 1);
        if (entryTop != null) spriteTop = Math.min(spriteTop, entryTop);
      }
    }

    if (!walking) mobile.animPhaseStart = null;

    // Equipment layers for humanoid bodies.
    if (drewBody) {
      const frameSet = { body: { data: animData, frame: bodyFrame, mirror }, equipment: [] };
      const previousEquipment = new Map(
        (mobile.lastFrameSet?.equipment || []).filter((entry) => entry.animId != null).map((entry) => [entry.animId, entry])
      );
      if (type === 'people' && !mobile.isGhost && this.assets.tileData) {
        for (const layer of equipmentLayers) {
          const item = mobile.getItem(layer);
          if (!item) continue;
          if (mobile.isDead && (layer === Layer.Hair || layer === Layer.Beard)) continue;
          const equipment = this.equipmentGraphics(mobile, item, gargoyle);
          if (!equipment) continue;
          const { animId, hue, partial } = equipment;
          const equip = this.assets.getAnim(animId, group, dir, hue, true, partial);
          if (!equip || !equip.meta.frames.length) {
            // Hold the previous pose for this layer while it streams in.
            const previous = previousEquipment.get(animId);
            if (previous) {
              const top = this.drawAnimFrame(ctx, previous.data, previous.frame, pos.sx, pos.sy, previous.mirror, 1);
              if (top != null) spriteTop = Math.min(spriteTop, top);
              frameSet.equipment.push(previous);
            }
            continue;
          }
          const frames = equip.meta.frames;
          let fi = this.animFrameIndex(mobile, anim, frames.length, sinceStart, serverPlaying, now, walking);
          const state = mobile.animRender;
          if (state && state.group === group && state.dir === dir && state.shift) {
            fi = (fi + state.shift) % frames.length;
          }
          const frame = frames[Math.min(fi, frames.length - 1)];
          const top = this.drawAnimFrame(ctx, equip, frame, pos.sx, pos.sy, mirror, 1);
          if (top != null) spriteTop = Math.min(spriteTop, top);
          frameSet.equipment.push({ data: equip, frame, mirror, animId });
        }
      }
      mobile.lastFrameSet = frameSet;
    }
    mobile.spriteTop = Number.isFinite(spriteTop) ? spriteTop : null;
  }

  equipmentGraphics(mobile, item, gargoyle) {
    let animId = this.assets.staticAnimId(item.graphic) || 0;
    if (!animId) return null;
    const conv = this.assets.equipConv(baseBodyGraphic(mobile), animId);
    if (gargoyle) animId = GARGOYLE_EQUIPMENT.get(animId) ?? animId;
    if (conv && conv.graphic > 0 && conv.graphic < 0x8000) animId = conv.graphic;
    let hue = item.hue || 0;
    let partial = this.assets.staticIsPartialHue(item.graphic);
    // 0x8000 on the wire is an explicit "hue only the grey parts" request.
    if (hue & 0x8000) {
      hue &= 0x7fff;
      partial = true;
    }
    if (!hue) {
      hue = conv?.color || 0;
      partial = false;
    }
    return { animId, hue, partial };
  }

  animFrameSource(mobile, serverPlaying, walking) {
    if (serverPlaying) return 'server';
    if (!walking) return 'idle';
    if (Number.isFinite(mobile.stepProgress) && Number.isFinite(mobile.walkStepIndex) && mobile.walkStepIndex >= 0) {
      return 'step';
    }
    return 'phase';
  }

  applyAnimContinuity(mobile, group, dir, baseIndex, count, walking, source) {
    const previous = mobile.animRender;
    let shift = 0;
    if (previous && previous.group === group) {
      if (previous.dir !== dir) {
        // Turning uses a different sheet, so start the new direction at the
        // frame the old one was showing instead of jumping back to frame 0.
        shift = previous.frame - baseIndex;
      } else if (previous.source !== source) {
        // Walk frames switch between step timing and the wall-clock fallback.
        // Continue from the next frame instead of jumping to the new base.
        shift = previous.frame + 1 - baseIndex;
      } else {
        shift = previous.shift || 0;
      }
    }
    shift = ((shift % count) + count) % count;
    const frame = (baseIndex + shift) % count;
    mobile.animRender = { group, dir, gameDir: mobile.direction & 7, frame, count, shift, walking, source };
    return frame;
  }

  animFrameIndex(mobile, anim, count, sinceStart, serverPlaying, now, walking = mobile.moving) {
    if (!count) return 0;
    if (serverPlaying) {
      const frameDelay = ANIM_FRAME_MS * (1 + (anim.delay || 0));
      const index = Math.floor(sinceStart / frameDelay) % count;
      return anim.forward ? index : count - 1 - index;
    }
    if (walking) {
      if (Number.isFinite(mobile.stepProgress) && Number.isFinite(mobile.walkStepIndex) && mobile.walkStepIndex >= 0) {
        // UO walk/run sheets interleave two steps: the first half of the
        // frames is one foot, the second half is the other. Alternate halves
        // per step so the cycle follows movement timing instead of wall clock.
        const half = Math.max(1, Math.ceil(count / 2));
        const offset = (mobile.walkStepIndex % 2) * half;
        const index = offset + Math.min(half - 1, Math.max(0, Math.floor(mobile.stepProgress * half)));
        return Math.min(count - 1, index);
      }
      if (mobile.animPhaseStart == null) mobile.animPhaseStart = now;
      return Math.floor((now - mobile.animPhaseStart) / ANIM_FRAME_MS) % count;
    }
    return 0;
  }

  drawAnimFrame(ctx, animData, frame, sx, sy, mirror, scale) {
    if (!frame) return null;
    const drawX = mirror ? sx - (frame.w - frame.cx) * scale : sx - frame.cx * scale;
    const drawY = sy - (frame.h + frame.cy) * scale;
    if (mirror) {
      ctx.save();
      ctx.translate(drawX + (frame.w * scale) / 2, drawY);
      ctx.scale(-1, 1);
      ctx.drawImage(animData.img, frame.x, frame.y, frame.w, frame.h, (-frame.w * scale) / 2, 0, frame.w * scale, frame.h * scale);
      ctx.restore();
    } else {
      ctx.drawImage(animData.img, frame.x, frame.y, frame.w, frame.h, drawX, drawY, frame.w * scale, frame.h * scale);
    }
    return drawY;
  }

  drawMobileText(ctx, m) {
    const pos = this.screenFor(m.renderX, m.renderY, m.renderZ);
    pos.sx += 22;
    pos.sy += 22;
    // Anchor overhead text to the top of the sprite we actually drew so it
    // clears tall, short, and mounted bodies instead of using a fixed offset.
    const spriteTop = Number.isFinite(m.spriteTop) ? m.spriteTop : pos.sy - 49;
    const nameY = spriteTop - 5;
    const dist = Math.max(Math.abs(m.x - this.world.player.x), Math.abs(m.y - this.world.player.y));
    const showNames = settings.get('showNames');
    const showBars = settings.get('showHealthBars');
    const showSpeech = settings.get('showSpeech');
    if (showNames && dist <= 14 && m.name && m !== this.world.player) {
      const nameColor = m.isGhost || m.isDead ? '#9aa0a6' : notorietyColor(m.notoriety);
      if (hasUoHtmlMarkup(m.name)) {
        const measured = measureUoHtml(ctx, m.name, {
          width: 220,
          defaultColor: nameColor,
          fontSize: 12,
          fontFamily: 'monospace',
        });
        drawServerText(ctx, m.name, {
          x: pos.sx - 110,
          y: nameY - Math.max(0, measured.height - 15),
          width: 220,
          height: measured.height,
          align: 'center',
          defaultColor: nameColor,
          fontSize: 12,
          fontFamily: 'monospace',
          clip: false,
        });
      } else {
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.fillStyle = nameColor;
        ctx.strokeText(m.name, pos.sx, nameY);
        ctx.fillText(m.name, pos.sx, nameY);
      }
    }
    if (showBars && m !== this.world.player && !m.isGhost && !m.isDead && m.hitsMax > 0 && (m.hits < m.hitsMax || m.yellowBar)) {
      const w = 44;
      const x = pos.sx - w / 2;
      const y = nameY + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = m.yellowBar ? '#e8c34a' : '#c73a3a';
      ctx.fillRect(x, y, (w * Math.max(0, m.hits)) / Math.max(1, m.hitsMax), 5);
    }
    if (showSpeech && m.lastSpeech && Date.now() - m.lastSpeech.time < 7000) {
      const speechColor = this.game?.ui?.speechColor?.(m.lastSpeech.hue) || '#ffe6a3';
      if (hasUoHtmlMarkup(m.lastSpeech.text)) {
        const measured = measureUoHtml(ctx, m.lastSpeech.text, {
          width: 220,
          defaultColor: speechColor,
          fontSize: 12,
          fontFamily: 'monospace',
        });
        drawServerText(ctx, m.lastSpeech.text, {
          x: pos.sx - 110,
          y: nameY - 12 - Math.max(0, measured.height - 15),
          width: 220,
          height: measured.height,
          align: 'center',
          defaultColor: speechColor,
          fontSize: 12,
          fontFamily: 'monospace',
          clip: false,
        });
      } else {
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const lines = wrapText(ctx, m.lastSpeech.text, 220);
        let y = nameY - 12;
        for (let i = lines.length - 1; i >= 0; i--) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.fillStyle = speechColor;
          ctx.strokeText(lines[i], pos.sx, y);
          ctx.fillText(lines[i], pos.sx, y);
          y -= 15;
        }
      }
    }
  }

  drawWeather(ctx, now) {
    if (!settings.get('weather')) return;
    const weather = this.world.weather;
    if (!weather.type || !weather.particles?.length) return;
    ctx.save();
    if (weather.type === 1) {
      ctx.strokeStyle = 'rgba(160,190,255,0.5)';
      ctx.lineWidth = 1;
      for (const p of weather.particles) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 4, p.y + 14);
        ctx.stroke();
      }
    } else if (weather.type === 2) {
      ctx.fillStyle = 'rgba(230,240,255,0.8)';
      for (const p of weather.particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawLighting(ctx) {
    if (!settings.get('lighting')) return;
    const light = this.world.light;
    const overall = light.displayOverall ?? light.overall;
    const personal = light.displayPersonal ?? light.personal;
    const darkness = Math.max(0, Math.min(30, overall - Math.min(5, personal || 0)));
    if (darkness <= 0) return;
    const alpha = (darkness / 30) * 0.72;
    ctx.fillStyle = `rgba(2,4,12,${alpha})`;
    ctx.fillRect(0, 0, this.width, this.height);
    const ps = this.playerScreen();
    const px = ps.x - this.camera.x;
    const py = ps.y - this.camera.y;
    const g = ctx.createRadialGradient(px, py, 20, px, py, 230);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(2,4,12,${alpha * 0.8})`);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  questArrowScreen() {
    if (!settings.get('questArrow')) return null;
    const arrow = this.world.questArrow;
    if (!arrow) return null;
    const p = this.screenFor(arrow.x, arrow.y, 0);
    const margin = 26;
    const cx = Math.max(margin, Math.min(this.width - margin, p.sx + 22));
    const cy = Math.max(margin, Math.min(this.height - margin, p.sy + 22));
    return { x: cx, y: cy, sx: p.sx + 22, sy: p.sy + 22, margin };
  }

  drawQuestArrow(ctx) {
    const point = this.questArrowScreen();
    if (!point) return;
    const { x: cx, y: cy, sx, sy } = point;
    const dx = sx - cx;
    const dy = sy - cy;
    ctx.save();
    ctx.strokeStyle = '#e8c34a';
    ctx.fillStyle = 'rgba(232,195,74,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.stroke();
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      const angle = Math.atan2(dy, dx);
      ctx.translate(cx + Math.cos(angle) * 12, cy + Math.sin(angle) * 12);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-4, -6);
      ctx.lineTo(-4, 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawWaypoints(ctx) {
    if (!settings.get('waypoints')) return;
    const waypoints = [...(this.world.waypoints || []), ...(this.world.localWaypoints || [])];
    for (const w of waypoints) {
      if (w.map !== undefined && w.map !== this.world.mapIndex) continue;
      const p = this.screenFor(w.x, w.y, 0);
      p.sx += 22;
      p.sy += 22;
      if (p.sx < 0 || p.sx > this.width || p.sy < 0 || p.sy > this.height) continue;
      ctx.save();
      ctx.strokeStyle = '#7fc7ff';
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy - 8);
      ctx.lineTo(p.sx + 8, p.sy);
      ctx.lineTo(p.sx, p.sy + 8);
      ctx.lineTo(p.sx - 8, p.sy);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  targetAt(mx, my) {
    const entity = this.entityAt(mx, my);
    if (entity) return { kind: 'entity', entity };
    const tile = this.screenToTile(mx, my);
    const overhead = this.overheadState();
    const cutZ = overhead.cut;
    let best = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = tile.x + dx;
        const ty = tile.y + dy;
        const block = this.world.getBlock(tx >> 3, ty >> 3);
        if (!block) continue;
        const idx = ((ty & 7) << 3) | (tx & 7);
        for (const s of this.world.staticGrid(block)[idx] || []) {
          if (s.z >= cutZ) continue;
          if (overhead.hideRoofs && ((this.assets.staticFlags(s.graphic) || 0) & ROOF_FLAG)) continue;
          const priorityZ = this.priorityZ(s.z, s.graphic);
          if (best && priorityZ < best.priorityZ) continue;
          const img = this.assets.getStatic(s.graphic, s.hue);
          if (!img) continue;
          const p = this.staticDrawPos(tx, ty, s.z, img);
          if (mx >= p.x && mx < p.x + img.width && my >= p.y && my < p.y + img.height) {
            best = { kind: 'static', graphic: s.graphic, x: tx, y: ty, z: s.z, priorityZ };
          }
        }
      }
    }
    if (best) return best;
    const block = this.world.getBlock(tile.x >> 3, tile.y >> 3);
    const cell = block?.cells[((tile.y & 7) << 3) | (tile.x & 7)];
    return { kind: 'land', graphic: 0, x: tile.x, y: tile.y, z: cell?.z || 0 };
  }

  drawDebugHover(ctx) {
    if (!this.game.debug) return;
    const serial = this.game.ui?.hoverSerial;
    if (!serial) return;
    const entity = this.world.get(serial);
    if (!entity || (entity.isItem && entity.container !== 0)) return;
    const bounds = this.entityBounds(entity);
    if (!bounds) return;
    ctx.save();
    ctx.strokeStyle = '#ff5fd2';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      Math.round(bounds.x) + 0.5,
      Math.round(bounds.y) + 0.5,
      Math.max(1, Math.round(bounds.w)),
      Math.max(1, Math.round(bounds.h))
    );
    ctx.setLineDash([]);
    const label = `0x${(entity.serial >>> 0).toString(16)} g:0x${(entity.graphic || 0).toString(16)}`;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const labelWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(bounds.x, bounds.y - 13, labelWidth + 6, 12);
    ctx.fillStyle = '#ff9de6';
    ctx.fillText(label, bounds.x + 3, bounds.y - 2);
    ctx.restore();
  }

  entityAt(mx, my) {
    let best = null;
    let bestDepth = -Infinity;
    const overhead = this.overheadState();
    const cutZ = overhead.cut;
    for (const entity of this.world.entities.values()) {
      if (!entity.isMobile && entity.container !== 0) continue;
      if ((entity.renderZ ?? entity.z) >= cutZ) continue;
      if (overhead.hideRoofs && !entity.isMobile && ((this.assets.staticFlags(entity.graphic) || 0) & ROOF_FLAG)) continue;
      const bounds = this.entityBounds(entity);
      if (!bounds) continue;
      if (mx < bounds.x || my < bounds.y || mx >= bounds.x + bounds.w || my >= bounds.y + bounds.h) continue;
      const depth = (entity.renderX ?? entity.x) + (entity.renderY ?? entity.y);
      const rank = entity.isMobile ? 1 : 0;
      const bestRank = best?.isMobile ? 1 : 0;
      if (depth > bestDepth || (depth === bestDepth && rank > bestRank)) {
        best = entity;
        bestDepth = depth;
      }
    }
    return best;
  }

  entityBounds(entity) {
    const x = entity.renderX ?? entity.x;
    const y = entity.renderY ?? entity.y;
    const z = entity.renderZ ?? entity.z;
    if (entity.isMobile) {
      const pos = this.screenFor(x, y, z);
      pos.sx += 22;
      pos.sy += 22;
      const { idleGroup, walkGroup, runGroup } = this.mobileAnimGroups(entity);
      const group = entity.moving
        ? (entity.running ? runGroup : walkGroup)
        : idleGroup;
      const { dir, mirror } = animDirection(entity.direction);
      const animData = this.assets.getAnim(entity.graphic, group, dir, entity.hue || 0);
      const frame = animData?.meta?.frames?.[0];
      if (frame) {
        return {
          x: mirror ? pos.sx - (frame.w - frame.cx) : pos.sx - frame.cx,
          y: pos.sy - (frame.h + frame.cy),
          w: frame.w,
          h: frame.h,
        };
      }
      return { x: pos.sx - 22, y: pos.sy - 66, w: 44, h: 66 };
    }
    if (entity.isMulti) {
      const parts = this.world.multiParts(entity);
      if (!parts?.length) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const part of parts) {
        if (!part.visible) continue;
        const img = this.assets.getStatic(part.graphic, 0);
        if (!img) continue;
        const p = this.staticDrawPos(x + part.x, y + part.y, z + part.z, img);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + img.width);
        maxY = Math.max(maxY, p.y + img.height);
      }
      if (minX === Infinity) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    const img = this.assets.getStatic(entity.graphic, entity.hue);
    if (!img) return null;
    const pos = this.staticDrawPos(x, y, z, img);
    const bounds = this.assets.staticBounds(entity.graphic, entity.hue);
    if (bounds) {
      return { x: pos.x + bounds.x, y: pos.y + bounds.y, w: bounds.w, h: bounds.h };
    }
    return { x: pos.x, y: pos.y, w: img.width, h: img.height };
  }

  mobilesInRect(rect) {
    const out = [];
    for (const entity of this.world.entities.values()) {
      if (!entity.isMobile || entity === this.world.player) continue;
      const bounds = this.entityBounds(entity);
      if (!bounds) continue;
      if (
        bounds.x >= rect.x + rect.w ||
        bounds.x + bounds.w <= rect.x ||
        bounds.y >= rect.y + rect.h ||
        bounds.y + bounds.h <= rect.y
      ) {
        continue;
      }
      out.push(entity);
    }
    out.sort(
      (a, b) =>
        (a.renderY ?? a.y) - (b.renderY ?? b.y) ||
        (a.renderX ?? a.x) - (b.renderX ?? b.x) ||
        a.serial - b.serial
    );
    return out;
  }

  drawHeld(ctx) {
    const held = this.game.held;
    if (!held) return;
    const img = this.assets.getStatic(held.graphic, held.hue);
    if (!img) return;
    ctx.globalAlpha = 0.85;
    const dx = this.mouse.x - img.width / 2;
    const dy = this.mouse.y - img.height / 2;
    ctx.drawImage(img, dx, dy);
    const amount = this.game.world.heldAmount || (held.amount > 1 ? held.amount : 0);
    if (amount > 1) {
      ctx.globalAlpha = 1;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(String(amount), dx + img.width - 12, dy + img.height - 2);
      ctx.fillStyle = '#ffe08a';
      ctx.fillText(String(amount), dx + img.width - 13, dy + img.height - 3);
    }
    ctx.globalAlpha = 1;
  }
}

function typeOrder(d) {
  return d.type === 'mobile' ? 2 : d.type === 'item' || d.type === 'multiPart' ? 1 : 0;
}

function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of raw.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out.slice(-4);
}
