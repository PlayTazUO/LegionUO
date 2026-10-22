import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { AssetService } from './assets.js';
import { attachWebSocketServer } from './ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'client');

function dirHasArt(dir) {
  try {
    const names = fs.readdirSync(dir).map((n) => n.toLowerCase());
    return names.includes('art.mul') || names.includes('artlegacymul.uop');
  } catch {
    return false;
  }
}

function detectUODir() {
  const seen = new Set();
  const add = (dir) => {
    if (dir && !seen.has(dir)) seen.add(dir);
  };

  add(path.join(os.homedir(), 'Library', 'Application Support', 'Ultima Adventures'));
  add(path.join(os.homedir(), 'Library', 'Application Support', 'Ultima Online'));
  add(path.join(os.homedir(), 'Documents', 'Ultima Online'));
  add('C:\\Program Files (x86)\\Electronic Arts\\Ultima Online Classic');
  add('C:\\Program Files\\Electronic Arts\\Ultima Online Classic');

  // TazUO launcher profiles know where each shard's data lives.
  const profileDirs = [
    path.join(os.homedir(), 'Library', 'Application Support', 'TazUO Launcher', 'Profiles', 'Settings'),
    '/Applications/TUO/Profiles/Settings',
  ];
  for (const dir of profileDirs) {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          if (json.ultimaonlinedirectory) add(json.ultimaonlinedirectory);
        } catch {
          /* ignore broken profile */
        }
      }
    } catch {
      /* ignore missing profile dir */
    }
  }

  // Common Windows/macOS TazUO install roots.
  for (const root of ['/Applications/TUO', path.join(os.homedir(), 'Applications', 'TUO')]) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) add(path.join(root, entry.name));
      }
    } catch {
      /* ignore */
    }
  }

  const dirs = [...seen].filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
  return dirs.find(dirHasArt) || dirs[0] || '';
}

function loadConfig() {
  const config = {
    uoDir: '',
    httpPort: 8080,
    host: '127.0.0.1',
    clientVersion: '7.0.104.0',
    mapCount: 6,
    cacheMb: 256,
    allowProxyHosts: [],
    defaultLoginHost: '',
    defaultLoginPort: 2593,
    loginEncryption: true,
    gameEncryption: true,
    language: 'enu',
    walkDelay: 400,
    runDelay: 200,
    mountedWalkDelay: 200,
    mountedRunDelay: 100,
    moveSpeedMultiplier: 1,
    shutdownPassphrase: '',
  };
  try {
    Object.assign(config, JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')));
  } catch {
    /* ignore */
  }
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--uo-dir' && args[i + 1]) config.uoDir = args[++i];
    else if (args[i] === '--port' && args[i + 1]) config.httpPort = Number(args[++i]);
    else if (args[i] === '--host' && args[i + 1]) config.host = args[++i];
  }
  if (process.env.UO_DIR) config.uoDir = process.env.UO_DIR;
  if (process.env.PORT) config.httpPort = Number(process.env.PORT);
  if (!config.uoDir) {
    config.uoDir = detectUODir();
  }
  return config;
}

const configPath = path.join(root, 'config.json');
let config = loadConfig();
let assets = new AssetService(config);
let configMtime = (() => {
  try {
    return fs.statSync(configPath).mtimeMs;
  } catch {
    return 0;
  }
})();

function reloadConfigIfChanged() {
  try {
    const mtime = fs.statSync(configPath).mtimeMs;
    if (mtime === configMtime) return;
    configMtime = mtime;
    const next = loadConfig();
    const changed =
      next.uoDir !== config.uoDir ||
      next.clientVersion !== config.clientVersion ||
      next.mapCount !== config.mapCount ||
      next.language !== config.language;
    if (!changed) {
      Object.assign(config, next);
      assets.setCacheLimit(config.cacheMb);
      return;
    }
    console.log(`[legionuo] config changed, reloading assets (${next.uoDir || 'no UO dir'})`);
    try {
      assets.files.closeAll();
    } catch {
      /* ignore */
    }
    Object.assign(config, next);
    assets = new AssetService(config);
  } catch {
    /* ignore */
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function sendJSON(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** `?partial=` is opt-in; absent means "let the asset type decide". */
function queryPartial(url) {
  if (!url.searchParams.has('partial')) return undefined;
  const value = String(url.searchParams.get('partial')).toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function sendBuffer(res, status, body, type, cache = 'public, max-age=86400') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': cache,
  });
  res.end(body);
}

function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!chunks.length) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MAP_BATCH_LIMIT = 1024;

function parseBlockList(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAP_BATCH_LIMIT) return null;
  const blocks = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const bx = Number(entry[0]);
    const by = Number(entry[1]);
    if (!Number.isInteger(bx) || !Number.isInteger(by) || bx < 0 || by < 0) return null;
    blocks.push([bx, by]);
  }
  return blocks;
}

const gzipCache = new WeakMap();

function sendJSONMaybeGzip(req, res, body, cache) {
  const type = 'application/json; charset=utf-8';
  if (!String(req.headers['accept-encoding'] || '').includes('gzip')) {
    sendBuffer(res, 200, body, type, cache);
    return;
  }
  let gz = gzipCache.get(body);
  if (!gz) {
    gz = zlib.gzipSync(body);
    gzipCache.set(body, gz);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Encoding': 'gzip',
    'Content-Length': gz.length,
    'Cache-Control': cache,
  });
  res.end(gz);
}

function serveStatic(res, urlPath) {
  let relative = decodeURIComponent(urlPath.split('?')[0]);
  if (relative === '/' || relative === '') relative = '/index.html';
  const filePath = path.resolve(clientDir, '.' + relative);
  if (!filePath.startsWith(clientDir + path.sep) && filePath !== path.join(clientDir, 'index.html')) {
    sendJSON(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJSON(res, 404, { error: 'not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    sendBuffer(res, 200, data, MIME[ext] || 'application/octet-stream', 'no-cache');
  });
}

let shuttingDown = false;

function passphraseMatches(supplied) {
  const expected = String(config.shutdownPassphrase || '');
  if (!expected) return false;
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestPassphrase(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="LegionUO shutdown", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('Shutdown passphrase required.\n');
}

/** Secret hook: `<any url>?shutdown` stops the server after a passphrase check. */
function handleShutdown(req, res) {
  if (!config.shutdownPassphrase) {
    sendJSON(res, 403, { error: 'shutdown disabled: set shutdownPassphrase in config.json' });
    return;
  }

  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Basic\s+(.+)$/i);
  let allowed = false;
  if (match) {
    try {
      const decoded = Buffer.from(match[1].trim(), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      // Browsers show username and password fields; accept the passphrase in
      // either one so it does not matter which the user fills in.
      const user = colon === -1 ? '' : decoded.slice(0, colon);
      const pass = colon === -1 ? decoded : decoded.slice(colon + 1);
      allowed = passphraseMatches(pass) || passphraseMatches(user);
    } catch {
      allowed = false;
    }
  }
  if (!allowed) {
    requestPassphrase(res);
    return;
  }

  if (shuttingDown) {
    sendJSON(res, 202, { ok: true, shuttingDown: true });
    return;
  }
  shuttingDown = true;
  console.log(`[legionuo] shutdown requested via ?shutdown from ${req.socket.remoteAddress}`);
  sendJSON(res, 200, { ok: true, shuttingDown: true });
  setTimeout(() => process.exit(0), 100);
}

const server = http.createServer(async (req, res) => {
  reloadConfigIfChanged();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (url.searchParams.has('shutdown')) {
    handleShutdown(req, res);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (pathname === '/api/config') {
      sendJSON(res, 200, {
        ...assets.info(),
        wsPath: '/proxy',
        defaultLoginHost: config.defaultLoginHost || '',
        defaultLoginPort: config.defaultLoginPort || 2593,
        allowProxyHosts: config.allowProxyHosts || [],
        loginEncryption: config.loginEncryption !== false,
        gameEncryption: config.gameEncryption !== false,
        walkDelay: config.walkDelay,
        runDelay: config.runDelay,
        mountedWalkDelay: config.mountedWalkDelay,
        mountedRunDelay: config.mountedRunDelay,
        moveSpeedMultiplier: config.moveSpeedMultiplier,
        features: { animations: true, gumps: true, maps: true, cliloc: true, sounds: true, fonts: true, music: true },
      });
      return;
    }

    if (pathname === '/api/hues') {
      sendJSON(res, 200, assets.hueInfo());
      return;
    }

    if (pathname === '/api/tiledata') {
      sendJSONMaybeGzip(req, res, assets.tiledataJSON(url.searchParams.get('names') === '1'), 'public, max-age=3600');
      return;
    }

    if (pathname === '/api/equipconv') {
      sendBuffer(res, 200, assets.equipConvJSON(), 'application/json; charset=utf-8', 'public, max-age=3600');
      return;
    }

    if (pathname === '/api/skills') {
      sendJSONMaybeGzip(req, res, assets.skillsJSON(), 'public, max-age=3600');
      return;
    }

    let m = pathname.match(/^\/api\/cliloc\/(\d+)$/);
    if (m) {
      const text = assets.clilocs.get(Number(m[1]));
      if (text == null) sendJSON(res, 404, { error: 'not found' });
      else sendJSON(res, 200, { id: Number(m[1]), text });
      return;
    }

    if (pathname === '/api/cliloc/all') {
      sendJSONMaybeGzip(req, res, assets.clilocs.allJSON(), 'public, max-age=86400');
      return;
    }

    m = pathname.match(/^\/api\/cliloc$/);
    if (m) {
      const ids = String(url.searchParams.get('ids') || '').split(',').map((x) => Number(x)).filter(Number.isFinite);
      const out = {};
      for (const id of ids) out[id] = assets.clilocs.get(id);
      sendJSON(res, 200, out);
      return;
    }

    m = pathname.match(/^\/api\/multi\/(\d+)$/);
    if (m) {
      sendJSON(res, 200, assets.multi(Number(m[1])));
      return;
    }

    m = pathname.match(/^\/api\/music\/(\d+)(\.mp3)?$/);
    if (m) {
      const track = assets.musicTrack(Number(m[1]));
      if (!track) sendJSON(res, 404, { error: 'music not found' });
      else sendBuffer(res, 200, track.data, track.type, 'public, max-age=86400');
      return;
    }

    m = pathname.match(/^\/api\/font\/(\d+)(\.png)?$/);
    if (m) {
      const hue = Number(url.searchParams.get('hue') || 0);
      const result = assets.font(Number(m[1]), hue);
      if (!result) sendJSON(res, 404, { error: 'font not found' });
      else if (m[2]) sendBuffer(res, 200, result.png, 'image/png', 'public, max-age=86400');
      else sendJSON(res, 200, result.meta);
      return;
    }

    m = pathname.match(/^\/api\/sound\/(\d+)(\.wav)?$/);
    if (m) {
      const sound = assets.sound(Number(m[1]));
      if (!sound) sendJSON(res, 404, { error: 'sound not found' });
      else sendBuffer(res, 200, sound, 'audio/wav', 'public, max-age=86400');
      return;
    }

    m = pathname.match(/^\/api\/art\/land\/(\d+)\.png$/);
    if (m) {
      const hue = Number(url.searchParams.get('hue') || 0);
      sendBuffer(res, 200, assets.artLand(Number(m[1]), hue, queryPartial(url)), 'image/png');
      return;
    }

    m = pathname.match(/^\/api\/art\/static\/(\d+)\.png$/);
    if (m) {
      const hue = Number(url.searchParams.get('hue') || 0);
      sendBuffer(res, 200, assets.artStatic(Number(m[1]), hue, queryPartial(url)), 'image/png');
      return;
    }

    m = pathname.match(/^\/api\/texmap\/(\d+)\.png$/);
    if (m) {
      const hue = Number(url.searchParams.get('hue') || 0);
      sendBuffer(res, 200, assets.texmap(Number(m[1]), hue, !!queryPartial(url)), 'image/png');
      return;
    }

    m = pathname.match(/^\/api\/tileart\/(\d+)$/);
    if (m) {
      const appearances = assets.tileArtAppearances(Number(m[1]));
      if (!appearances) sendJSON(res, 404, { error: 'no tile art appearance' });
      else sendJSON(res, 200, { appearances }, 'public, max-age=86400');
      return;
    }

    m = pathname.match(/^\/api\/gump\/(\d+)\.png$/);
    if (m) {
      const id = Number(m[1]);
      if (!assets.gumps.exists(id)) {
        sendJSON(res, 404, { error: 'gump not found' });
        return;
      }
      const hue = Number(url.searchParams.get('hue') || 0);
      sendBuffer(res, 200, assets.gump(id, hue, !!queryPartial(url)), 'image/png');
      return;
    }

    m = pathname.match(/^\/api\/anim\/(\d+)\/(\d+)\/(\d+)(\.png)?$/);
    if (m) {
      const body = Number(m[1]);
      const action = Number(m[2]);
      const dir = Number(m[3]);
      const hue = Number(url.searchParams.get('hue') || 0);
      const equip = url.searchParams.get('equip') === '1';
      const partial = !!queryPartial(url);
      if (action >= 80 || dir >= 5) {
        sendJSON(res, 400, { error: 'invalid animation' });
        return;
      }
      const result = assets.animation(body, action, dir, hue, equip, partial);
      if (m[4]) sendBuffer(res, 200, result.png, 'image/png', 'public, max-age=86400');
      else sendJSON(res, 200, result.meta);
      return;
    }

    m = pathname.match(/^\/api\/map\/(\d+)\/(\d+)\/(\d+)$/);
    if (m) {
      const useXFiles = ['1', 'true'].includes(String(url.searchParams.get('x') || '').toLowerCase());
      const block = assets.mapBlock(Number(m[1]), Number(m[2]), Number(m[3]), useXFiles);
      if (!block) sendJSON(res, 404, { error: 'no map block' });
      else sendJSONMaybeGzip(req, res, Buffer.from(JSON.stringify(block)), 'public, max-age=86400');
      return;
    }

    if (pathname === '/api/map/batch') {
      if (req.method !== 'POST') {
        sendJSON(res, 405, { error: 'method not allowed' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJSON(res, 400, { error: String(err?.message || err) });
        return;
      }
      const map = Number(body?.map);
      const blocks = parseBlockList(body?.blocks);
      if (!Number.isInteger(map) || map < 0 || !blocks) {
        sendJSON(res, 400, { error: 'invalid map batch' });
        return;
      }
      const useXFiles = body?.x === true || body?.x === 1 || body?.x === '1';
      const out = blocks.map(([bx, by]) => assets.mapBlock(map, bx, by, useXFiles));
      const payload = Buffer.from(JSON.stringify({ map, x: useXFiles, blocks: out }));
      sendJSONMaybeGzip(req, res, payload, 'no-store');
      return;
    }

    if (pathname === '/api/radarcol') {
      const buf = assets.radarColors();
      if (!buf) sendJSON(res, 404, { error: 'radarcol.mul not found' });
      else sendBuffer(res, 200, buf, 'application/octet-stream', 'public, max-age=86400');
      return;
    }

    if (pathname === '/api/mapimage') {
      const number = (name) => Number(url.searchParams.get(name));
      const facet = number('facet');
      const x0 = number('x0');
      const y0 = number('y0');
      const x1 = number('x1');
      const y1 = number('y1');
      const width = number('w');
      const height = number('h');
      if (![facet, x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0 || x1 < 0 || y1 < 0) {
        sendJSON(res, 400, { error: 'invalid map bounds' });
        return;
      }
      const png = assets.mapImage(facet, x0, y0, x1, y1, width, height);
      if (!png) sendJSON(res, 404, { error: 'facet map not found' });
      else sendBuffer(res, 200, png, 'image/png', 'public, max-age=3600');
      return;
    }

    if (pathname === '/api/health') {
      sendJSON(res, 200, { ok: true, uoDir: config.uoDir, cache: assets.cacheStats() });
      return;
    }

    serveStatic(res, pathname);
  } catch (err) {
    console.error('[legionuo] request error', req.url, err);
    sendJSON(res, 500, { error: String(err?.message || err) });
  }
});

attachWebSocketServer(server, config);

// Reuse sockets for the burst of small asset requests that happens whenever a
// map region or container streams in. Browsers normally cap us at six
// connections, so keeping them alive avoids reconnecting during those bursts.
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

server.listen(config.httpPort, config.host, () => {
  console.log(`[legionuo] asset server listening on http://${config.host}:${config.httpPort}`);
  console.log(`[legionuo] UO data: ${config.uoDir || '(not configured)'}`);
  const info = assets.info();
  console.log(`[legionuo] art: ${info.paths.art || 'NOT FOUND'}`);
  console.log(`[legionuo] gumps: ${info.paths.gumps || 'NOT FOUND'}`);
  console.log(`[legionuo] tiledata: ${info.paths.tiledata || 'NOT FOUND'}`);
  console.log(`[legionuo] cliloc: ${info.paths.cliloc || 'NOT FOUND'}`);
  if (!config.uoDir) console.log('[legionuo] Set uoDir in config.json or pass --uo-dir <path>');
  const proxyHosts = config.defaultLoginHost
    ? [config.defaultLoginHost, ...(config.allowProxyHosts || [])]
    : config.allowProxyHosts || [];
  console.log(
    `[legionuo] proxy: default login host ${config.defaultLoginHost || '(none)'}, allowed hosts ${
      proxyHosts.length ? proxyHosts.join(', ') : '(any)'
    }`
  );
});
