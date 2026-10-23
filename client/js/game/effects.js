const LIGHTNING_GRAPHIC = 0x4e20;
const LIGHTNING_FRAMES = 10;
const LIGHTNING_INTERVAL = 50;

function normalizeHue(hue) {
  hue = (hue || 0) & 0xffff;
  if (!hue) return 0;
  const partial = hue & 0x8000;
  const value = (hue & 0x7fff) + 1;
  return (partial | (value & 0x7fff)) & 0xffff;
}

function blendMode(blend) {
  switch (blend) {
    case 1:
      return 'multiply';
    case 2:
    case 3:
    case 4:
      return 'screen';
    default:
      return 'source-over';
  }
}

export class EffectsManager {
  constructor(world, assets) {
    this.world = world;
    this.assets = assets;
    this.effects = [];
    this.texts = [];
  }

  add(effect) {
    const now = performance.now();
    const hue = normalizeHue(effect.hue);
    const lightning = effect.type === 1;
    const moving = effect.moving || effect.type === 0;
    const graphic = lightning ? LIGHTNING_GRAPHIC : effect.graphic;
    let duration;
    if (effect.lifeMs != null) {
      duration = effect.lifeMs;
    } else if (moving) {
      const dist = Math.hypot(
        (effect.dx || 0) - (effect.sx || 0),
        (effect.dy || 0) - (effect.sy || 0)
      );
      duration = Math.max(400, (Number.isFinite(dist) ? dist : 1) * 90);
    } else if (effect.duration > 0) {
      duration = effect.duration * 50;
    } else {
      duration = 1000;
    }
    const entry = {
      ...effect,
      graphic,
      hue,
      lightning,
      moving,
      start: now,
      life: lightning ? LIGHTNING_FRAMES * LIGHTNING_INTERVAL : Math.max(250, duration),
      spatial: effect.source || effect.target,
    };
    this.effects.push(entry);
    if (this.effects.length > 200) this.effects.shift();
    this.prefetch(entry);
  }

  addMoving(effect) {
    this.add({ ...effect, type: 0, moving: true });
  }

  addDamage(entity, damage) {
    if (!entity) return;
    this.texts.push({
      entity,
      text: `-${damage}`,
      hue: 0x22,
      start: performance.now(),
      life: 1600,
      offset: 0,
      damage: true,
    });
    this.world.game?.ui?.journal?.addDamage(entity, damage);
  }

  prefetch(effect) {
    if (effect.lightning) {
      for (let i = 0; i < LIGHTNING_FRAMES; i++) {
        this.assets.getGump(LIGHTNING_GRAPHIC + i, effect.hue);
      }
      return;
    }
    const frames = this.effectFrames(effect);
    if (frames) {
      for (const graphic of frames) this.assets.getEffectArt(graphic, effect.hue);
    }
  }

  effectFrames(effect) {
    if (effect.frames) return effect.frames;
    const meta = this.assets.getEffectMeta(effect.graphic);
    if (!meta || !meta.frames || !meta.frames.length) return null;
    effect.frames = meta.frames;
    const base = effect.speed ? effect.speed * 10 : 50;
    effect.frameInterval = Math.max(10, meta.frameInterval ? meta.frameInterval * base : base);
    return effect.frames;
  }

  update(dt) {
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.start < e.life);
    this.texts = this.texts.filter((t) => now - t.start < t.life);
    for (const t of this.texts) t.offset += dt * (t.damage ? 28 : 14);
  }

  drawEffect(ctx, e, now, screenFor) {
    if (e.lightning) {
      const index = Math.min(
        LIGHTNING_FRAMES - 1,
        Math.floor((now - e.start) / LIGHTNING_INTERVAL)
      );
      const img = this.assets.getGump(LIGHTNING_GRAPHIC + index, e.hue);
      if (!img) return;
      const { sx, sy } = screenFor(e.sx || 0, e.sy || 0, e.sz || 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(img, sx - img.width / 2, sy - img.height);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    let x = e.sx;
    let y = e.sy;
    let z = e.sz;
    if (e.moving) {
      const t = Math.min(1, (now - e.start) / e.life);
      x = e.sx + (e.dx - e.sx) * t;
      y = e.sy + (e.dy - e.sy) * t;
      z = e.sz + (e.dz - e.sz) * t;
    } else {
      const hasTarget = e.dx !== undefined && (e.dx !== 0 || e.dy !== 0);
      const hasSource = e.sx !== undefined && (e.sx !== 0 || e.sy !== 0);
      if (!hasTarget && !hasSource) return;
      if (hasTarget) {
        x = e.dx;
        y = e.dy;
        z = e.dz;
      }
    }
    if (x === undefined || y === undefined) return;

    let graphic = e.graphic;
    const frames = this.effectFrames(e);
    if (frames) {
      const interval = e.frameInterval || 50;
      const index = Math.floor((now - e.start) / interval) % frames.length;
      graphic = frames[index];
    }
    const img = this.assets.getEffectArt(graphic, e.hue);
    if (!img) return;

    const { sx, sy } = screenFor(x, y, z || 0);
    ctx.globalAlpha = e.blend === 5 ? 0.5 : 1;
    ctx.globalCompositeOperation = blendMode(e.blend);
    ctx.drawImage(img, sx - img.width / 2, sy - img.height + 22);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  draw(ctx, camera, screenFor) {
    const now = performance.now();
    for (const e of this.effects) {
      this.drawEffect(ctx, e, now, screenFor);
    }

    for (const t of this.texts) {
      if (!t.entity) continue;
      const { sx, sy } = screenFor(t.entity.renderX, t.entity.renderY, t.entity.renderZ);
      const alpha = 1 - (now - t.start) / t.life;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `${t.damage ? 'bold ' : ''}13px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = t.damage ? '#ff4444' : '#ffe08a';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3;
      const textY = sy - 70 - t.offset;
      ctx.strokeText(t.text, sx, textY);
      ctx.fillText(t.text, sx, textY);
      ctx.globalAlpha = 1;
    }
  }
}
