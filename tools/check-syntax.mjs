import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set(['.git', 'node_modules', 'test-data', 'coverage', 'dist']);

function collect(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) collect(path.join(dir, entry.name), files);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const files = collect(root).sort();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({ file: path.relative(root, file), output: result.stderr || result.stdout });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`\n${failure.file}\n${failure.output}`);
  }
  console.error(`Syntax check failed for ${failures.length} of ${files.length} files.`);
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} files.`);
