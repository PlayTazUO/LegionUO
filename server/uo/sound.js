function wavHeader(dataLength, sampleRate = 22050, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * (bits >> 3);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export class SoundManager {
  constructor(files) {
    this.files = files;
    this.loaded = false;
    this.file = null;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.file = this.files.mul('sound.mul', 'soundidx.mul');
    if (!this.file) this.file = this.files.mul('soundlegacymul.uop', 'soundidx.mul');
  }

  get(id) {
    this.load();
    if (!this.file || !Number.isFinite(id) || id < 0) return null;
    const entry = this.file.entries[id];
    if (!entry || entry.length <= 0) return null;
    const data = this.files.readEntry(this.file, entry);
    if (!data || data.length < 4) return null;
    if (data.toString('ascii', 0, 4) === 'RIFF') return data;
    return Buffer.concat([wavHeader(data.length), data]);
  }
}
