import { Game } from './game/game.js';

function applyBranding(value) {
  const name = String(value || 'LegionUO').trim() || 'LegionUO';
  document.title = name;
  const brand = document.querySelector('.brand');
  if (!brand) return;
  // Accent the trailing capital run (e.g. the "UO" in "LegionUO") when present.
  const match = name.match(/^(.*)([A-Z]{1,4})$/);
  if (!match || !match[1]) {
    brand.textContent = name;
    return;
  }
  brand.textContent = '';
  brand.append(document.createTextNode(match[1]));
  const accent = document.createElement('span');
  accent.textContent = match[2];
  brand.append(accent);
}

(async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[assets] service worker registration failed:', err);
    });
  }
  let config = {};
  try {
    config = await fetch('/api/config').then((r) => r.json());
  } catch (err) {
    const status = document.getElementById('loginStatus');
    if (status) status.textContent = 'Cannot reach the asset server. Start it with: npm start';
    console.error(err);
    return;
  }
  applyBranding(config.name);
  const params = new URLSearchParams(location.search);
  if (params.get('version')) config.clientVersion = params.get('version');
  if (params.get('uo')) config.uoDir = params.get('uo');
  const game = new Game(config);
  window.legionuo = game;
  await game.start();
})();
