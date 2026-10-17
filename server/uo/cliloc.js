import fs from 'node:fs';
import { bwtDecompress } from './bwt.js';

export class ClilocManager {
  constructor(files, language = 'enu') {
    this.files = files;
    this.language = language;
    this.loaded = false;
    this.entries = new Map();
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    let path = this.files.find(`Cliloc.${this.language}`);
    if (!path) path = this.files.find('Cliloc.enu');
    if (!path) return;
    let buf = fs.readFileSync(path);
    if (buf.length > 3 && buf[3] === 0x8e) buf = bwtDecompress(buf);
    if (buf.length < 6) return;
    let ptr = 6;
    const length = buf.length;
    while (ptr + 7 <= length) {
      const number = buf.readInt32LE(ptr);
      ptr += 4;
      ptr += 1;
      const textLength = buf.readInt16LE(ptr);
      ptr += 2;
      const bytes = textLength > 0 ? buf.subarray(ptr, ptr + textLength) : Buffer.alloc(0);
      ptr += Math.max(0, textLength);
      let end = bytes.indexOf(0);
      if (end < 0) end = bytes.length;
      this.entries.set(number, bytes.subarray(0, end).toString('utf8'));
    }

    // Shard-local additions/overrides, last write wins.
    const ours = this.files.find('Clilocs.txt');
    if (ours) {
      try {
        for (const rawLine of fs.readFileSync(ours, 'utf8').split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const at = line.search(/[\t ]/);
          if (at <= 0) continue;
          const number = parseInt(line.slice(0, at), 10);
          if (Number.isFinite(number)) this.entries.set(number, line.slice(at + 1).trim());
        }
      } catch {
        /* ignore */
      }
    }
  }

  get(id) {
    this.load();
    return this.entries.get(id) ?? null;
  }

  allJSON() {
    this.load();
    return Buffer.from(JSON.stringify(Object.fromEntries(this.entries)));
  }

  translate(id, args = '', capitalize = false) {
    let text = this.get(id);
    if (text == null) return null;
    if (args) {
      const parts = String(args).split('\t');
      for (let i = 0; i < parts.length; i++) {
        text = text.split(`~${i + 1}_`).join(parts[i]);
      }
    }
    if (capitalize) {
      text = text.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return text;
  }
}
