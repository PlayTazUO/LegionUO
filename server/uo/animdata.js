const FRAME_SIZE = 68;
const MAX_FRAMES = 64;

/**
 * animdata.mul describes how item/effect art animates. Each record holds up to
 * 64 signed frame offsets, the number of frames, the frame interval and the
 * starting frame. Effect graphics in 0x70 packets are static art entries; the
 * animation is produced by cycling `graphic + frameOffset`.
 */
export class AnimDataManager {
  constructor(files) {
    this.files = files;
    this.file = null;
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.file = this.files.mul('animdata.mul');
  }

  get(graphic) {
    this.load();
    if (!this.file) return null;
    const pos = graphic * FRAME_SIZE + 4 * ((graphic >> 3) + 1);
    if (pos + FRAME_SIZE > this.file.reader.length) return null;
    const buf = this.file.reader.readAt(pos, FRAME_SIZE);
    const frameCount = Math.min(buf[65], MAX_FRAMES);
    if (!frameCount) return null;
    const frameData = [];
    for (let i = 0; i < frameCount; i++) frameData.push(buf.readInt8(i));
    return {
      frameData,
      frameCount,
      frameInterval: buf[66],
      frameStart: buf[67],
    };
  }

  animation(graphic) {
    const data = this.get(graphic);
    if (!data) {
      return { frameCount: 0, frameInterval: 0, frames: [] };
    }
    const frames = data.frameData.map((offset) => (graphic + offset) & 0xffff);
    return {
      frameCount: data.frameCount,
      frameInterval: data.frameInterval,
      frames,
    };
  }
}
