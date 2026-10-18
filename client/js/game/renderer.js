import { Layer, animDirection } from './entity.js';
import { hasUoHtmlMarkup, drawServerText, measureUoHtml } from './html.js';
import { settings } from './settings.js';

const PEOPLE_LAYERS = [
  Layer.Cloak,
  Layer.Torso,
  Layer.Arms,
  Layer.Legs,
  Layer.Shoes,
  Layer.Skirt,
  Layer.Robe,
  Layer.Helm,
  Layer.Gloves,
  Layer.Necklace,
  Layer.Ring,
  Layer.Bracelet,
  Layer.TwoHanded,
  Layer.OneHanded,
  Layer.Hair,
  Layer.Beard,
];

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
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.dpr = dpr;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  playerScreen() {
    const p = this.world.player;
    if (!p) return { x: 0, y: 0 };
    return { x: (p.renderX - p.renderY) * 22 - 22, y: (p.renderX + p.renderY) * 22 - p.renderZ * 4 - 22 };
  }

  updateCamera() {
    const ps = this.playerScreen();
    this.camera.x = ps.x - this.width / 2;
    this.camera.y = ps.y - this.height / 2;
  }

  screenFor(x, y, z = 0) {
    return {
      sx: (x - y) * 22 - 22 - this.camera.x,
      sy: (x + y) * 22 - z * 4 - 22 - this.camera.y,
    };
  }

  screenToTile(mx, my) {
    const wx = mx + this.camera.x + 22;
    const wy = my + this.camera.y + 22;
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
    this.world.ensureMapAround(this.world.player.x, this.world.player.y, 4);

    const groundItems = new Map();
    const mobiles = new Map();
    for (const e of this.world.entities.values()) {
      if (e.isMobile) {
        if (!e.isDead || e.isCorpse || e.isGhost) {
          const key = `${e.x},${e.y}`;
          if (!mobiles.has(key)) mobiles.set(key, []);
          mobiles.get(key).push(e);
        }
      } else if (e.container === 0 && e.serial !== this.world.playerSerial) {
        const key = `${e.x},${e.y}`;
        if (!groundItems.has(key)) groundItems.set(key, []);
        groundItems.get(key).push(e);
      }
    }

    const range = 23;
    const px = this.world.player.x;
    const py = this.world.player.y;

    for (let depth = -range * 2; depth <= range * 2; depth++) {
      // x + y = depth keeps a stable isometric back-to-front order.
      for (let x = px - range; x <= px + range; x++) {
        const y = depth - x + (px + py);
        if (y < py - range || y > py + range) continue;
        if (x < 0 || y < 0) continue;
        this.drawTile(ctx, x, y, groundItems, mobiles, now);
      }
    }

    this.effects.draw(ctx, this.camera, (x, y, z) => this.screenFor(x, y, z));
    this.drawWeather(ctx, now);
    this.drawLighting(ctx);
    this.drawQuestArrow(ctx);
    this.drawWaypoints(ctx);
  }

  drawTile(ctx, x, y, groundItems, mobiles, now) {
    const block = this.world.getBlock(x >> 3, y >> 3);
    if (!block) return;
    const lx = x & 7;
    const ly = y & 7;
    const cell = block.cells[(ly << 3) | lx];
    const pos = this.screenFor(x, y, cell.z);
    if (pos.sx < -80 || pos.sx > this.width + 80 || pos.sy < -80 || pos.sy > this.height + 80) return;

    const land = this.assets.getLand(cell.tile);
    if (land) ctx.drawImage(land, pos.sx, pos.sy);

    const drawables = [];
    for (const s of this.staticGrid(block)[(ly << 3) | lx] || []) {
      drawables.push({ type: 'static', z: s.z, graphic: s.graphic, hue: s.hue });
    }
    for (const item of groundItems.get(`${x},${y}`) || []) {
      drawables.push({ type: 'item', z: item.z, graphic: item.graphic, hue: item.hue, entity: item, amount: item.amount });
    }
    for (const m of mobiles.get(`${x},${y}`) || []) {
      drawables.push({ type: 'mobile', z: m.z, entity: m });
    }
    drawables.sort((a, b) => a.z - b.z || typeOrder(a) - typeOrder(b));

    for (const d of drawables) {
      if (d.type === 'mobile') {
        this.drawMobile(ctx, d.entity, now);
      } else if (d.type === 'item' && d.entity?.isMulti) {
        this.drawMulti(ctx, d.entity);
      } else if (d.type === 'item' && d.graphic === 0x2006 && this.world.corpses.has(d.entity.serial)) {
        this.drawCorpse(ctx, d.entity, this.world.corpses.get(d.entity.serial), now);
      } else {
        const img = this.assets.getStatic(d.graphic, d.hue);
        if (!img) continue;
        const p = this.screenFor(x, y, d.z);
        ctx.drawImage(img, p.sx - img.width, p.sy - img.height);
        if (d.amount > 1) {
          ctx.fillStyle = '#ffe08a';
          ctx.font = '11px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(String(d.amount), p.sx - 8, p.sy - 14);
        }
      }
    }

    // Overhead names and bars are drawn after the tile's objects.
    for (const m of mobiles.get(`${x},${y}`) || []) {
      this.drawMobileText(ctx, m);
    }
  }

  drawMulti(ctx, item) {
    const parts = this.assets.getMulti(item.graphic);
    if (!parts) return;
    for (const part of parts) {
      if (!part.visible) continue;
      const img = this.assets.getStatic(part.graphic, 0);
      if (!img) continue;
      const p = this.screenFor(item.x + part.x, item.y + part.y, item.z + part.z);
      ctx.drawImage(img, p.sx - img.width, p.sy - img.height);
    }
  }

  drawCorpse(ctx, item, corpse, now) {
    const type = this.game.getAnimType(corpse.graphic);
    const group = type === 'people' ? 21 : type === 'low' ? 8 : 2;
    const { dir, mirror } = animDirection(corpse.direction || 0);
    const animData = this.assets.getAnim(corpse.graphic, group, dir, corpse.hue || 0);
    if (!animData || !animData.meta.frames.length) {
      const img = this.assets.getStatic(0x2006, 0);
      if (img) {
        const p = this.screenFor(item.x, item.y, item.z);
        ctx.drawImage(img, p.sx - img.width, p.sy - img.height);
      }
      return;
    }
    const frames = animData.meta.frames;
    const f = frames[frames.length - 1];
    const p = this.screenFor(item.x, item.y, item.z);
    this.drawAnimFrame(ctx, animData, f, p.sx, p.sy, mirror, 1);
  }

  motionProgress(mobile, now) {
    if (mobile.motion) {
      const t = (now - mobile.motion.start) / Math.max(1, mobile.motion.duration);
      return Math.max(0, Math.min(1, t));
    }
    if (mobile === this.world.player) {
      const step = this.world.playerStepAt(now);
      if (step) {
        const t = (now - step.startTime) / Math.max(1, step.duration);
        return Math.max(0, Math.min(1, t));
      }
    }
    return null;
  }

  drawMobile(ctx, mobile, now) {
    const type = this.game.getAnimType(mobile.graphic);
    const anim = mobile.animation;
    const sinceStart = now - (anim?.start || 0);
    const serverPlaying = anim?.fromServer && sinceStart < Math.max(400, (anim.frameCount || 5) * 120);
    const stepProgress = mobile.moving ? this.motionProgress(mobile, now) : null;
    let group;
    if (serverPlaying) group = anim.group;
    else if (mobile.moving) group = type === 'people' ? (mobile.inWarMode ? 15 : 0) : type === 'low' ? 0 : 0;
    else group = type === 'people' ? 4 : type === 'low' ? 2 : 1;
    if (mobile.inWarMode && type === 'people' && !mobile.moving && !serverPlaying) group = 4;

    const { dir, mirror } = animDirection(mobile.direction);
    const animData = this.assets.getAnim(mobile.graphic, group, dir, mobile.hue || 0);
    const pos = this.screenFor(mobile.renderX, mobile.renderY, mobile.renderZ);

    if (animData && animData.meta.frames.length) {
      const frames = animData.meta.frames;
      let frameIndex = 0;
      if (serverPlaying) {
        frameIndex = Math.floor(sinceStart / 120) % frames.length;
        if (!anim.forward) frameIndex = frames.length - 1 - frameIndex;
      } else if (mobile.moving && stepProgress != null) {
        frameIndex = Math.min(frames.length - 1, Math.floor(stepProgress * frames.length));
      } else if (mobile.moving) {
        frameIndex = Math.floor(now / 130) % frames.length;
      }
      const f = frames[Math.min(frameIndex, frames.length - 1)];
      this.drawAnimFrame(ctx, animData, f, pos.sx, pos.sy, mirror, 1);
    }

    // Equipment layers for humanoid bodies.
    if (type === 'people' && !mobile.isGhost && this.assets.tileData) {
      for (const layer of PEOPLE_LAYERS) {
        const item = mobile.getItem(layer);
        if (!item) continue;
        const animId = this.assets.staticAnimId(item.graphic);
        if (!animId) continue;
        const equip = this.assets.getAnim(animId, group, dir, item.hue || 0);
        if (!equip || !equip.meta.frames.length) continue;
        const frames = equip.meta.frames;
        let fi = 0;
        if (serverPlaying) {
          fi = Math.floor(sinceStart / 120) % frames.length;
          if (!anim.forward) fi = frames.length - 1 - fi;
        } else if (mobile.moving && stepProgress != null) {
          fi = Math.min(frames.length - 1, Math.floor(stepProgress * frames.length));
        } else if (mobile.moving) {
          fi = Math.floor(now / 130) % frames.length;
        }
        this.drawAnimFrame(ctx, equip, frames[fi], pos.sx, pos.sy, mirror, 1);
      }
    }
  }

  drawAnimFrame(ctx, animData, frame, sx, sy, mirror, scale) {
    if (!frame) return;
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
  }

  drawMobileText(ctx, m) {
    const pos = this.screenFor(m.renderX, m.renderY, m.renderZ);
    const dist = Math.max(Math.abs(m.x - this.world.player.x), Math.abs(m.y - this.world.player.y));
    const showNames = settings.get('showNames');
    const showBars = settings.get('showHealthBars');
    const showSpeech = settings.get('showSpeech');
    if (showNames && dist <= 14 && m.name && m !== this.world.player) {
      if (hasUoHtmlMarkup(m.name)) {
        const measured = measureUoHtml(ctx, m.name, {
          width: 220,
          defaultColor: notorietyColor(m.notoriety),
          fontSize: 12,
          fontFamily: 'monospace',
        });
        drawServerText(ctx, m.name, {
          x: pos.sx - 110,
          y: pos.sy - 54 - Math.max(0, measured.height - 15),
          width: 220,
          height: measured.height,
          align: 'center',
          defaultColor: notorietyColor(m.notoriety),
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
        ctx.fillStyle = notorietyColor(m.notoriety);
        ctx.strokeText(m.name, pos.sx, pos.sy - 54);
        ctx.fillText(m.name, pos.sx, pos.sy - 54);
      }
    }
    if (showBars && m !== this.world.player && m.hitsMax > 0 && (m.hits < m.hitsMax || m.yellowBar)) {
      const w = 44;
      const x = pos.sx - w / 2;
      const y = pos.sy - 50;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = m.yellowBar ? '#e8c34a' : '#c73a3a';
      ctx.fillRect(x, y, (w * Math.max(0, m.hits)) / Math.max(1, m.hitsMax), 5);
    }
    if (showSpeech && m.lastSpeech && Date.now() - m.lastSpeech.time < 7000) {
      if (hasUoHtmlMarkup(m.lastSpeech.text)) {
        const measured = measureUoHtml(ctx, m.lastSpeech.text, {
          width: 220,
          defaultColor: '#ffe6a3',
          fontSize: 12,
          fontFamily: 'monospace',
        });
        drawServerText(ctx, m.lastSpeech.text, {
          x: pos.sx - 110,
          y: pos.sy - 66 - Math.max(0, measured.height - 15),
          width: 220,
          height: measured.height,
          align: 'center',
          defaultColor: '#ffe6a3',
          fontSize: 12,
          fontFamily: 'monospace',
          clip: false,
        });
      } else {
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const lines = wrapText(ctx, m.lastSpeech.text, 220);
        let y = pos.sy - 66;
        for (let i = lines.length - 1; i >= 0; i--) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.fillStyle = '#ffe6a3';
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
    const darkness = Math.max(0, Math.min(30, light.overall - Math.min(5, light.personal || 0)));
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

  drawQuestArrow(ctx) {
    if (!settings.get('questArrow')) return;
    const arrow = this.world.questArrow;
    if (!arrow) return;
    const p = this.screenFor(arrow.x, arrow.y, 0);
    const margin = 26;
    const cx = Math.max(margin, Math.min(this.width - margin, p.sx));
    const cy = Math.max(margin, Math.min(this.height - margin, p.sy));
    const dx = p.sx - cx;
    const dy = p.sy - cy;
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
    for (const w of this.world.waypoints || []) {
      if (w.map !== undefined && w.map !== this.world.mapIndex) continue;
      const p = this.screenFor(w.x, w.y, 0);
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

  staticGrid(block) {
    if (!block._staticGrid) {
      block._staticGrid = Array.from({ length: 64 }, () => []);
      for (const s of block.statics || []) {
        const idx = (s.y << 3) | s.x;
        if (idx >= 0 && idx < 64) block._staticGrid[idx].push(s);
      }
    }
    return block._staticGrid;
  }

  targetAt(mx, my) {
    const entity = this.entityAt(mx, my);
    if (entity) return { kind: 'entity', entity };
    const tile = this.screenToTile(mx, my);
    let best = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = tile.x + dx;
        const ty = tile.y + dy;
        const block = this.world.getBlock(tx >> 3, ty >> 3);
        if (!block) continue;
        const idx = ((ty & 7) << 3) | (tx & 7);
        for (const s of this.staticGrid(block)[idx] || []) {
          if (best && s.z <= best.z) continue;
          const img = this.assets.getStatic(s.graphic, s.hue);
          if (!img) continue;
          const p = this.screenFor(tx, ty, s.z);
          if (mx >= p.sx - img.width && mx < p.sx && my >= p.sy - img.height && my < p.sy) {
            best = { kind: 'static', graphic: s.graphic, x: tx, y: ty, z: s.z };
          }
        }
      }
    }
    if (best) return best;
    const block = this.world.getBlock(tile.x >> 3, tile.y >> 3);
    const cell = block?.cells[((tile.y & 7) << 3) | (tile.x & 7)];
    return { kind: 'land', graphic: 0, x: tile.x, y: tile.y, z: cell?.z || 0 };
  }

  entityAt(mx, my) {
    let best = null;
    let bestDepth = -Infinity;
    for (const entity of this.world.entities.values()) {
      if (!entity.isMobile && entity.container !== 0) continue;
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
      const type = this.game.getAnimType(entity.graphic);
      const group = entity.moving ? (type === 'people' ? (entity.inWarMode ? 15 : 0) : 0) : type === 'people' ? 4 : type === 'low' ? 2 : 1;
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
      const parts = this.assets.getMulti(entity.graphic);
      if (!parts?.length) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const part of parts) {
        if (!part.visible) continue;
        const img = this.assets.getStatic(part.graphic, 0);
        if (!img) continue;
        const p = this.screenFor(x + part.x, y + part.y, z + part.z);
        minX = Math.min(minX, p.sx - img.width);
        minY = Math.min(minY, p.sy - img.height);
        maxX = Math.max(maxX, p.sx);
        maxY = Math.max(maxY, p.sy);
      }
      if (minX === Infinity) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    const img = this.assets.getStatic(entity.graphic, entity.hue);
    if (!img) return null;
    const pos = this.screenFor(x, y, z);
    return { x: pos.sx - img.width, y: pos.sy - img.height, w: img.width, h: img.height };
  }

  drawHeld(ctx) {
    const held = this.game.held;
    if (!held) return;
    const img = this.assets.getStatic(held.graphic, held.hue);
    if (!img) return;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, this.mouse.x - img.width / 2, this.mouse.y - img.height / 2);
    ctx.globalAlpha = 1;
  }
}

function typeOrder(d) {
  return d.type === 'mobile' ? 2 : d.type === 'item' ? 1 : 0;
}

function notorietyColor(noto) {
  switch (noto) {
    case 1:
      return '#6fb7ff';
    case 2:
      return '#7ee08a';
    case 3:
      return '#c8c8c8';
    case 4:
      return '#ffd34a';
    case 5:
      return '#ff8a3a';
    case 6:
      return '#ff4a4a';
    case 7:
      return '#ff5cd6';
    default:
      return '#e8e8e8';
  }
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
