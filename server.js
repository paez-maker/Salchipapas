// Servidor de presencia: cada cliente simula su propio héroe y el servidor
// solo reenvía posiciones y acciones (atacar, saltar, dash) a los demás.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
// Acepta index.html junto a server.js o dentro de public/
const INDEX = [path.join(__dirname, 'index.html'), path.join(__dirname, 'public', 'index.html')]
  .find(f => fs.existsSync(f)) || path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Falta public/index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (u === '/health') {
    res.writeHead(200); res.end('ok');
  } else {
    res.writeHead(404); res.end('No encontrado');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
const players = new Map();
let nextId = 1;

const num = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
const ACTIONS = new Set(['attack', 'dash', 'jump']);

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) { ws.close(1013, 'Servidor lleno'); return; }
  const id = nextId++;
  const p = { id, h: null, x: 0, z: 0, yw: 0, aa: 0, ix: 0, iy: 0 };
  players.set(id, p);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ t: 'hello', id }));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && typeof m.h === 'string' && /^[a-z0-9]{1,20}$/.test(m.h)) {
      p.h = m.h;
    } else if (m.t === 'pos') {
      p.x = num(m.x, 200); p.z = num(m.z, 200);
      p.yw = num(m.yw, 100); p.aa = num(m.aa, 100);
      p.ix = num(m.ix, 1); p.iy = num(m.iy, 1);
    } else if (m.t === 'ev' && ACTIONS.has(m.k) && p.h) {
      const msg = JSON.stringify({ t: 'ev', id, k: m.k });
      for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(msg);
    }
  });
  ws.on('close', () => players.delete(id));
});

// Estado de todos los jugadores, 15 veces por segundo
setInterval(() => {
  if (wss.clients.size < 2) return;
  const state = JSON.stringify({ t: 'state', p: [...players.values()].filter(p => p.h) });
  for (const c of wss.clients) if (c.readyState === 1) c.send(state);
}, 66);

// Cierra conexiones muertas (los hosting gratuitos cortan las inactivas)
setInterval(() => {
  for (const c of wss.clients) {
    if (!c.isAlive) { c.terminate(); continue; }
    c.isAlive = false; c.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Endless Horde online en http://localhost:${PORT}`));
