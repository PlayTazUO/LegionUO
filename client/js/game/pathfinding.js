const DIRECTIONS = [
  { dx: 0, dy: -1, cost: 10, dir: 0 },
  { dx: 1, dy: -1, cost: 14, dir: 1 },
  { dx: 1, dy: 0, cost: 10, dir: 2 },
  { dx: 1, dy: 1, cost: 14, dir: 3 },
  { dx: 0, dy: 1, cost: 10, dir: 4 },
  { dx: -1, dy: 1, cost: 14, dir: 5 },
  { dx: -1, dy: 0, cost: 10, dir: 6 },
  { dx: -1, dy: -1, cost: 14, dir: 7 },
];

const keyOf = (x, y) => `${x},${y}`;

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].f <= items[index].f) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length && last) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left].f < items[smallest].f) smallest = left;
        if (right < items.length && items[right].f < items[smallest].f) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
    return top;
  }
}

function heuristic(x, y, goalX, goalY) {
  const dx = Math.abs(x - goalX);
  const dy = Math.abs(y - goalY);
  return 10 * (dx + dy) + (14 - 2 * 10) * Math.min(dx, dy);
}

function nearestWalkable(world, targetX, targetY, radius, cache) {
  const exact = tileAt(world, targetX, targetY, cache);
  if (exact?.walkable) return { x: targetX, y: targetY };
  for (let r = 1; r <= radius; r++) {
    let best = null;
    let bestDist = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = targetX + dx;
        const y = targetY + dy;
        const info = tileAt(world, x, y, cache);
        if (!info?.walkable) continue;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function tileAt(world, x, y, cache) {
  if (x < 0 || y < 0) return null;
  const key = keyOf(x, y);
  if (cache.has(key)) return cache.get(key);
  const info = world.tileInfo(x, y);
  cache.set(key, info);
  return info;
}

export async function findPath(world, startX, startY, targetX, targetY, options = {}) {
  if (!world.assets?.tileData) await world.assets?.loadTileData?.();
  const margin = options.margin ?? 12;
  const maxNodes = options.maxNodes ?? 12000;
  const minX = Math.max(0, Math.min(startX, targetX) - margin);
  const minY = Math.max(0, Math.min(startY, targetY) - margin);
  const maxX = Math.max(startX, targetX) + margin;
  const maxY = Math.max(startY, targetY) + margin;
  await world.preloadRegion(minX, minY, maxX, maxY);

  const cache = new Map();
  const goal = nearestWalkable(world, targetX, targetY, options.targetRadius ?? 3, cache);
  if (!goal) return null;
  if (goal.x === startX && goal.y === startY) return [];

  const open = new MinHeap();
  const openByKey = new Map();
  const closed = new Set();
  const startInfo = tileAt(world, startX, startY, cache);
  const startNode = {
    x: startX,
    y: startY,
    g: 0,
    f: heuristic(startX, startY, goal.x, goal.y),
    parent: null,
  };
  open.push(startNode);
  openByKey.set(keyOf(startX, startY), startNode);

  let explored = 0;
  while (open.size) {
    const current = open.pop();
    const currentKey = keyOf(current.x, current.y);
    if (closed.has(currentKey)) continue;
    if (openByKey.get(currentKey) === current) openByKey.delete(currentKey);
    closed.add(currentKey);
    explored++;

    if (current.x === goal.x && current.y === goal.y) {
      const path = [];
      let node = current;
      while (node && !(node.x === startX && node.y === startY)) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    if (explored > maxNodes) break;
    const currentInfo = currentKey === keyOf(startX, startY) ? startInfo : tileAt(world, current.x, current.y, cache);

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const nextKey = keyOf(nx, ny);
      if (closed.has(nextKey)) continue;
      const info = tileAt(world, nx, ny, cache);
      if (!info?.walkable) continue;

      if (dir.dx !== 0 && dir.dy !== 0) {
        const sideA = tileAt(world, current.x + dir.dx, current.y, cache);
        const sideB = tileAt(world, current.x, current.y + dir.dy, cache);
        if (!sideA?.walkable || !sideB?.walkable) continue;
        if (currentInfo?.noDiagonal || info.noDiagonal) continue;
      }

      if (currentInfo && Math.abs(info.z - currentInfo.z) > 12) continue;

      const g = current.g + dir.cost;
      const existing = openByKey.get(nextKey);
      if (existing && existing.g <= g) continue;
      const node = {
        x: nx,
        y: ny,
        g,
        f: g + heuristic(nx, ny, goal.x, goal.y),
        parent: current,
      };
      openByKey.set(nextKey, node);
      open.push(node);
    }
  }
  return null;
}
