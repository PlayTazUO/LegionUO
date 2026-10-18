export class EffectsManager {
  constructor(world, assets) {
    this.world = world;
    this.assets = assets;
    this.effects = [];
    this.texts = [];
  }

  add(effect) {
    const now = performance.now();
    this.effects.push({
      ...effect,
      start: now,
      life: Math.max(250, (effect.duration || 10) * 100),
      spatial: effect.source || effect.target,
    });
    if (this.effects.length > 200) this.effects.shift();
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

  update(dt) {
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.start < e.life);
    this.texts = this.texts.filter((t) => now - t.start < t.life);
    for (const t of this.texts) t.offset += dt * (t.damage ? 28 : 14);
  }

  draw(ctx, camera, screenFor) {
    const now = performance.now();
    for (const e of this.effects) {
      if (e.moving) {
        const t = Math.min(1, (now - e.start) / e.life);
        const x = e.sx + (e.dx - e.sx) * t;
        const y = e.sy + (e.dy - e.sy) * t;
        const z = e.sz + (e.dz - e.sz) * t;
        const img = this.assets.getStatic(e.graphic, e.hue || 0);
        if (!img) continue;
        const { sx, sy } = screenFor(x, y, z);
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.drawImage(img, sx - img.width, sy - img.height);
        ctx.globalAlpha = 1;
      } else {
        const source = e.sx !== undefined && (e.sx !== 0 || e.sy !== 0) ? { x: e.sx, y: e.sy, z: e.sz } : null;
        const target = e.dx !== undefined && (e.dx !== 0 || e.dy !== 0) ? { x: e.dx, y: e.dy, z: e.dz } : null;
        const point = target || source;
        if (!point) continue;
        const img = this.assets.getStatic(e.graphic, e.hue || 0);
        if (!img) continue;
        const { sx, sy } = screenFor(point.x, point.y, point.z);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(img, sx - img.width / 2, sy - img.height / 2);
        ctx.globalAlpha = 1;
      }
    }

    for (const t of this.texts) {
      if (!t.entity) continue;
      const img = null;
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
