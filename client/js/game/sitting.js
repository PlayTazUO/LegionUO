import { animDirection } from './entity.js';

export const CHAIR_TABLE = new Map([
  [1113, [0, -1, 4, -1, 2, 2, false]],
  [1114, [-1, 2, -1, 6, 2, 2, false]],
  [1115, [0, -1, 4, -1, 2, 2, false]],
  [1116, [-1, 2, -1, 6, 2, 2, false]],
  [2602, [0, 2, 4, 6, -4, -4, false]],
  [2603, [0, 2, 4, 6, -8, -8, false]],
  [2860, [-1, 2, -1, 6, 2, 2, false]],
  [2861, [0, -1, 4, -1, 2, 2, false]],
  [2862, [4, 4, 4, 4, 0, 0, false]],
  [2863, [2, 2, 2, 2, 6, 6, false]],
  [2864, [6, 6, 6, 6, -8, 8, true]],
  [2865, [0, 0, 0, 0, 0, 4, true]],
  [2866, [4, 4, 4, 4, 0, 0, false]],
  [2867, [2, 2, 2, 2, 0, 0, false]],
  [2894, [2, 2, 2, 2, 0, 0, false]],
  [2895, [4, 4, 4, 4, 0, 0, false]],
  [2896, [0, 0, 0, 0, 0, 0, true]],
  [2897, [6, 6, 6, 6, 0, 0, true]],
  [2898, [2, 2, 2, 2, 0, 0, false]],
  [2899, [4, 4, 4, 4, 0, 0, false]],
  [2900, [0, 0, 0, 0, 0, 0, true]],
  [2901, [6, 6, 6, 6, 0, 0, true]],
  [2902, [2, 2, 2, 2, 4, 4, false]],
  [2903, [4, 4, 4, 4, 4, 4, false]],
  [2904, [6, 6, 6, 6, 0, 8, true]],
  [2905, [0, 0, 0, 0, 0, 8, true]],
  [2906, [2, 2, 2, 2, 8, 8, false]],
  [2907, [4, 4, 4, 4, 8, 8, false]],
  [2908, [0, 0, 0, 0, 0, 8, true]],
  [2909, [6, 6, 6, 6, 0, 8, true]],
  [2910, [0, 2, 4, 6, -8, -8, false]],
  [2911, [-1, 2, -1, 6, 3, 14, false]],
  [2912, [-1, 2, -1, 6, 3, 14, false]],
  [2913, [-1, 2, -1, 6, 3, 14, false]],
  [2914, [-1, 2, -1, 6, 3, 10, false]],
  [2915, [-1, 2, -1, 6, 3, 10, false]],
  [2916, [-1, 2, -1, 6, 3, 10, false]],
  [2917, [0, -1, 4, -1, 3, 10, false]],
  [2918, [0, -1, 4, -1, 3, 10, false]],
  [2919, [0, -1, 4, -1, 3, 10, false]],
  [2920, [0, -1, 4, -1, 3, 10, false]],
  [2921, [0, -1, 4, -1, 3, 10, false]],
  [2922, [0, -1, 4, -1, 3, 10, false]],
  [2961, [4, 4, 4, 4, 6, 6, false]],
  [2962, [4, 4, 4, 4, 6, 6, false]],
  [2963, [2, 2, 2, 2, 6, 6, false]],
  [2964, [2, 2, 2, 2, 6, 6, false]],
  [3315, [-1, 2, -1, 6, 2, 8, false]],
  [3316, [-1, 2, -1, 6, 2, 8, false]],
  [3318, [0, -1, 4, -1, 2, 8, false]],
  [3319, [0, -1, 4, -1, 2, 8, false]],
  [3664, [4, 4, 4, 4, 4, 4, false]],
  [3665, [4, 4, 4, 4, 4, 4, false]],
  [3666, [2, 2, 2, 2, 0, 0, false]],
  [3667, [2, 2, 2, 2, 0, 0, false]],
  [4169, [-1, 2, -1, 6, 2, 2, false]],
  [4170, [0, -1, 4, -1, 2, 2, false]],
  [4604, [0, 2, 4, 6, 2, 7, false]],
  [4615, [0, -1, 4, -1, 3, 10, false]],
  [4616, [0, -1, 4, -1, 3, 10, false]],
  [4617, [0, -1, 4, -1, 3, 10, false]],
  [4618, [0, -1, 4, -1, 3, 10, false]],
  [4619, [0, -1, 4, -1, 3, 10, false]],
  [4620, [0, -1, 4, -1, 3, 10, false]],
  [4632, [4, 4, 4, 4, 4, 4, false]],
  [4633, [2, 2, 2, 2, 4, 4, false]],
  [4634, [0, 0, 0, 0, 0, 8, true]],
  [4635, [6, 6, 6, 6, 0, 8, true]],
  [5415, [2, 2, 2, 2, 0, 0, false]],
  [6001, [0, 2, 4, 6, 0, 0, false]],
  [6006, [0, 2, 4, 6, 0, 0, false]],
  [6009, [0, 2, 4, 6, 0, 0, false]],
  [7623, [-1, 2, -1, 6, 3, 10, false]],
  [7624, [-1, 2, -1, 6, 3, 10, false]],
  [7625, [-1, 2, -1, 6, 3, 10, false]],
  [7626, [0, -1, 4, -1, 3, 10, false]],
  [7627, [0, -1, 4, -1, 3, 10, false]],
  [7628, [0, -1, 4, -1, 3, 10, false]],
  [7629, [-1, 2, -1, 6, 3, 10, false]],
  [7630, [-1, 2, -1, 6, 3, 10, false]],
  [7631, [-1, 2, -1, 6, 3, 10, false]],
  [7632, [0, -1, 4, -1, 3, 10, false]],
  [7633, [0, -1, 4, -1, 3, 10, false]],
  [7634, [-1, 2, -1, 6, 3, 10, false]],
  [10840, [4, 4, 4, 4, 0, 0, false]],
  [10841, [2, 2, 2, 2, 0, 0, false]],
  [10842, [0, 2, 4, 6, 0, 0, false]],
  [10843, [0, 2, 4, 6, 10, 10, false]],
  [10879, [0, 2, 4, 6, 0, 0, false]],
  [10880, [0, 2, 4, 6, 0, 0, false]],
  [11743, [0, 2, 4, 6, 2, 2, false]],
  [11744, [0, 2, 4, 6, 2, 2, false]],
  [11747, [2, 2, 2, 2, 4, 4, false]],
  [11748, [4, 4, 4, 4, 4, 4, false]],
  [11749, [6, 6, 6, 6, 4, 4, false]],
  [11750, [0, 0, 0, 0, 4, 4, false]],
  [11755, [0, 0, 0, 0, 4, 4, false]],
  [11756, [4, 4, 4, 4, 4, 4, false]],
  [11757, [2, 2, 2, 2, 4, 4, false]],
  [11758, [6, 6, 6, 6, 4, 4, false]],
  [11765, [0, 2, 4, 6, 4, 4, false]],
  [11766, [0, 2, 4, 6, 4, 4, false]],
  [12424, [0, 2, 4, 6, 4, 4, false]],
  [12425, [0, 2, 4, 6, 4, 4, false]],
  [12426, [0, 2, 4, 6, 4, 4, false]],
  [12427, [0, 2, 4, 6, 4, 4, false]],
  [12698, [-1, 2, -1, 6, 2, 2, false]],
  [12699, [0, -1, 4, -1, 2, 2, false]],
  [13805, [0, 2, 4, 6, 0, 0, false]],
  [13806, [0, 2, 4, 6, 0, 0, false]],
  [15871, [0, -1, 4, -1, 2, 2, false]],
  [15872, [-1, 2, -1, 6, 2, 2, false]],
  [16419, [4, 4, 4, 4, 4, 4, false]],
  [16420, [2, 2, 2, 2, 0, 0, false]],
  [16423, [4, 4, 4, 4, 4, 4, false]],
  [16424, [4, 4, 4, 4, 4, 4, false]],
  [16425, [2, 2, 2, 2, 0, 0, false]],
  [16426, [2, 2, 2, 2, 0, 0, false]],
  [19420, [4, 4, 4, 4, 4, 4, false]],
  [19483, [4, 4, 4, 4, 4, 4, false]],
  [19486, [2, 2, 2, 2, 6, 6, false]],
  [19584, [4, 4, 4, 4, 4, 4, false]],
  [19585, [2, 2, 2, 2, 0, 0, false]],
  [19586, [4, 4, 4, 4, 4, 4, false]],
  [19587, [4, 4, 4, 4, 4, 4, false]],
  [19588, [2, 2, 2, 2, 0, 0, false]],
  [19589, [2, 2, 2, 2, 0, 0, false]],
  [19590, [4, 4, 4, 4, 4, 4, false]],
  [19591, [4, 4, 4, 4, 4, 4, false]],
  [19592, [2, 2, 2, 2, 0, 0, false]],
  [19593, [2, 2, 2, 2, 0, 0, false]],
  [19594, [2, 2, 2, 2, 0, 0, false]],
  [19595, [2, 2, 2, 2, 0, 0, false]],
  [19596, [2, 2, 2, 2, 0, 0, false]],
  [19597, [4, 4, 4, 4, 4, 4, false]],
  [19598, [4, 4, 4, 4, 4, 4, false]],
  [19599, [4, 4, 4, 4, 4, 4, false]],
  [19936, [2, 2, 2, 2, 0, 0, false]],
  [25532, [0, -1, 4, -1, 3, 10, false]],
  [25533, [0, -1, 4, -1, 3, 10, false]],
  [25539, [-1, 2, -1, 6, 3, 14, false]],
  [25540, [-1, 2, -1, 6, 3, 14, false]],
  [39276, [4, 4, 4, 4, 4, 4, false]],
  [39287, [2, 2, 2, 2, 0, 0, false]],
  [40023, [6, 6, 6, 6, 6, 4, false]],
  [40024, [6, 6, 6, 6, 6, 4, false]],
  [40025, [0, 0, 0, 0, 4, 4, false]],
  [40026, [0, 0, 0, 0, 4, 4, false]],
  [40029, [6, 6, 6, 6, 6, 4, false]],
  [40030, [6, 6, 6, 6, 6, 4, false]],
  [40031, [6, 6, 6, 6, 6, 4, false]],
  [40032, [0, 0, 0, 0, 4, 4, false]],
  [40033, [0, 0, 0, 0, 4, 4, false]],
  [40034, [0, 0, 0, 0, 4, 4, false]],
  [40590, [0, 0, 0, 0, 4, 4, false]],
  [40591, [6, 6, 6, 6, 6, 4, false]],
  [40592, [2, 2, 2, 2, 0, 0, false]],
  [40593, [4, 4, 4, 4, 4, 4, false]],
  [40607, [0, 0, 0, 0, 4, 4, false]],
  [40608, [6, 6, 6, 6, 6, 4, false]],
  [40609, [4, 4, 4, 4, 4, 4, false]],
  [40610, [2, 2, 2, 2, 0, 0, false]],
  [41052, [6, 6, 6, 6, 6, 4, false]],
  [41053, [4, 4, 4, 4, 4, 4, false]],
  [41054, [0, 0, 0, 0, 4, 4, false]],
  [41055, [2, 2, 2, 2, 0, 0, false]],
  [41489, [0, 2, 4, 6, -4, -4, false]],
  [42218, [4, 4, 4, 4, 4, 4, false]],
  [42219, [2, 2, 2, 2, 0, 0, false]],
  [42374, [4, 4, 4, 4, 4, 4, false]],
  [42375, [2, 2, 2, 2, 0, 0, false]],
]);

const GENERIC_CHAIR = [0, 2, 4, 6, 0, 0, false];

function chairData(graphic) {
  return CHAIR_TABLE.get(graphic & 0xffff) || null;
}

function matchChair(world, graphic) {
  const known = chairData(graphic);
  if (known) return known;
  const name = world.assets?.staticName?.(graphic & 0xffff);
  return name && /chair|bench|throne|stool/i.test(name) ? GENERIC_CHAIR : null;
}

export function findSittingInfo(world, mobile) {
  const x = mobile?.x;
  const y = mobile?.y;
  const z = mobile?.z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  const block = world.getBlock(x >> 3, y >> 3);
  if (block) {
    for (const s of world.staticsAt(block, x & 7, y & 7)) {
      if (Math.abs(z - s.z) > 1) continue;
      const data = matchChair(world, s.graphic);
      if (data) return data;
    }
  }

  for (const entity of world.entities.values()) {
    if (!entity.isItem || !entity.hasPosition) continue;
    if (entity.isMulti) {
      const dx = x - entity.x;
      const dy = y - entity.y;
      if (Math.abs(dx) > 32 || Math.abs(dy) > 32) continue;
      const parts = world.multiParts(entity);
      if (!parts) continue;
      for (const part of parts) {
        if (!part.visible || part.x !== dx || part.y !== dy) continue;
        if (Math.abs(z - (entity.z + (part.z || 0))) > 1) continue;
        const data = matchChair(world, part.graphic);
        if (data) return data;
      }
      continue;
    }
    if (entity.container) continue;
    if (entity.x !== x || entity.y !== y) continue;
    if (Math.abs(z - entity.z) > 1) continue;
    const data = matchChair(world, entity.graphic);
    if (data) return data;
  }

  return null;
}

export function sittingPose(data, direction) {
  if (!data) return null;
  if (data === GENERIC_CHAIR) {
    const pose = animDirection(direction);
    return { dir: pose.dir, mirror: pose.mirror, offsetX: 0, offsetY: 0 };
  }
  let dir = direction & 7;

  switch (dir) {
    case 7:
    case 0:
      dir = data[0] === -1 ? (dir === 7 ? data[3] : data[1]) : data[0];
      break;
    case 1:
    case 2:
      dir = data[1] === -1 ? (dir === 1 ? data[0] : data[2]) : data[1];
      break;
    case 3:
    case 4:
      dir = data[2] === -1 ? (dir === 3 ? data[1] : data[3]) : data[2];
      break;
    case 5:
    case 6:
      dir = data[3] === -1 ? (dir === 5 ? data[2] : data[0]) : data[3];
      break;
  }

  let mirror = false;
  switch (dir) {
    case 0:
      mirror = true;
      dir = 3;
      break;
    case 2:
      mirror = true;
      dir = 1;
      break;
    case 4:
      mirror = false;
      dir = 1;
      break;
    case 6:
      mirror = false;
      dir = 3;
      break;
    default: {
      const pose = animDirection(direction);
      return { dir: pose.dir, mirror: pose.mirror, offsetX: 0, offsetY: 0 };
    }
  }

  const offsetY = data[4];
  const mirrorOffsetY = data[5];
  let offsetX = 0;
  let drawOffsetY = 0;

  if (mirror) {
    if (dir === 3) {
      drawOffsetY = 25 + mirrorOffsetY;
      offsetX = 4;
    } else {
      drawOffsetY = offsetY + 9;
    }
  } else if (dir === 3) {
    drawOffsetY = 23 + mirrorOffsetY;
    offsetX = -3;
  } else {
    drawOffsetY = 10 + offsetY;
    offsetX = -9;
  }

  return { dir, mirror, offsetX, offsetY: drawOffsetY + 1 };
}
