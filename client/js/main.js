import { Game } from './game/game.js';

(async () => {
  let config = {};
  try {
    config = await fetch('/api/config').then((r) => r.json());
  } catch (err) {
    const status = document.getElementById('loginStatus');
    if (status) status.textContent = 'Cannot reach the LegionUO asset server. Start it with: npm start';
    console.error(err);
    return;
  }
  const params = new URLSearchParams(location.search);
  if (params.get('version')) config.clientVersion = params.get('version');
  if (params.get('uo')) config.uoDir = params.get('uo');
  const game = new Game(config);
  window.legionuo = game;
  await game.start();
})();
