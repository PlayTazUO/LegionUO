import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testData = path.join(root, 'tools', 'test-data');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      /* server not accepting connections yet */
    }
    await sleep(100);
  }
  throw new Error('server did not become ready within 10 seconds');
}

async function expectStatus(url, expected, check) {
  const response = await fetch(url);
  if (response.status !== expected) {
    throw new Error(`${url} returned ${response.status}, expected ${expected}`);
  }
  if (check) await check(response);
  return response;
}

async function main() {
  console.log('Generating test data...');
  const generated = spawnSync(process.execPath, [path.join(root, 'tools', 'make-test-data.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (generated.status !== 0) throw new Error('failed to generate test data');

  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'server', 'index.js'),
      '--uo-dir',
      testData,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
    ],
    { cwd: root, env: { ...process.env, UO_DIR: testData, PORT: String(port), HTTPS_PORT: '0' } }
  );

  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  const cleanup = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  process.on('exit', cleanup);

  try {
    await waitForServer(port, child);
    const base = `http://127.0.0.1:${port}`;

    await expectStatus(`${base}/api/health`, 200, async (response) => {
      const body = await response.json();
      if (!body.ok) throw new Error('/api/health did not report ok');
    });
    await expectStatus(`${base}/api/config`, 200, async (response) => {
      const body = await response.json();
      if (!body.name) throw new Error('/api/config did not include a server name');
    });
    await expectStatus(`${base}/api/hues`, 200);
    await expectStatus(`${base}/`, 200, async (response) => {
      const type = response.headers.get('content-type') || '';
      if (!type.includes('text/html')) throw new Error('/ did not return HTML');
    });

    console.log('Smoke test passed.');
  } catch (error) {
    console.error(output.trim());
    throw error;
  } finally {
    cleanup();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    process.removeListener('exit', cleanup);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
