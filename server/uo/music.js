import fs from 'node:fs';
import path from 'node:path';

const FALLBACK = [
  'oldult01', 'create1', 'dragflit', 'oldult02', 'oldult03', 'oldult04', 'oldult05', 'oldult06',
  'stones2', 'britain1', 'britain2', 'bucsden', 'jhelom', 'lbcastle', 'linelle', 'magincia',
  'minoc', 'ocllo', 'samlethe', 'serpents', 'skarabra', 'trinsic', 'vesper', 'wind', 'yew',
  'cave01', 'dungeon9', 'forest_a', 'intown01', 'jungle_a', 'mountn_a', 'plains_a', 'sailing',
  'swamp_a', 'tavern01', 'tavern02', 'tavern03', 'tavern04', 'combat1', 'combat2', 'combat3',
  'death', 'loginloop',
];

export class MusicManager {
  constructor(files) {
    this.files = files;
    this.loaded = false;
    this.tracks = new Map();
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    let config = this.files.find('Music/Digital/Config.txt') || this.files.find('Music/Config.txt');
    if (config) {
      try {
        for (const line of fs.readFileSync(config, 'utf8').split(/\r?\n/)) {
          const parts = line.trim().split(/[\s,]+/).filter(Boolean);
          if (parts.length < 2) continue;
          const index = Number(parts[0]);
          const name = parts[1].replace(/\.mp3$/i, '');
          const loop = parts[2] ? !/^(0|false|no)$/i.test(parts[2]) : true;
          if (Number.isFinite(index)) this.tracks.set(index, { name, loop });
        }
      } catch {
        /* ignore broken music config */
      }
    }
    if (!this.tracks.size) {
      FALLBACK.forEach((name, index) => this.tracks.set(index, { name, loop: true }));
    }
  }

  get(index) {
    this.load();
    const track = this.tracks.get(Number(index));
    if (!track) return null;
    const file = this.files.find(`${track.name}.mp3`);
    if (!file) return null;
    try {
      return { data: fs.readFileSync(file), type: 'audio/mpeg', loop: track.loop, name: track.name };
    } catch {
      return null;
    }
  }

  directory() {
    return path.dirname(this.files.find('Music/Digital/Config.txt') || this.files.find('Music/Config.txt') || '');
  }
}
