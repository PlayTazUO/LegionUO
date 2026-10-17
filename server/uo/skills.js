export class SkillsManager {
  constructor(files) {
    this.files = files;
    this.loaded = false;
    this.skills = [];
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    let mul = this.files.mul('skills.mul', 'skills.idx');
    if (!mul) mul = this.files.mul('Skills.mul', 'Skills.idx');
    if (!mul) return;
    let index = 0;
    for (const entry of mul.entries) {
      if (!entry || entry.length <= 0) continue;
      const raw = mul.reader.readAt(entry.offset, entry.length);
      if (!raw || raw.length < 1) continue;
      const hasAction = raw.readInt8(0) !== 0;
      let end = raw.indexOf(0, 1);
      if (end < 0) end = raw.length;
      const name = raw.subarray(1, end).toString('latin1').trim();
      this.skills.push({ index: index++, name, hasAction });
    }
  }

  toJSON() {
    this.load();
    return this.skills;
  }
}
