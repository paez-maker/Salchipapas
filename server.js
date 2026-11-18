// Servidor autoritativo: el cliente solo envía input, el servidor simula todo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const W = 1200, H = 700;          // tamaño del mapa
const TICK = 30;                  // simulaciones por segundo
const SPEED = 260;                // px/s
const BULLET_SPEED = 700, BULLET_LIFE = 1.1, BULLET_DMG = 25;
const RADIUS = 18, FIRE_COOLDOWN = 0.22, RESPAWN = 2.5;

// --- Servidor HTTP para servir el cliente ---
const server = http.createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : path.basename(req.url);
  const full = path.join(__dirname, 'public', file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const players = new Map();  // id -> jugador
const bullets = [];
let nextId = 1;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COLORS = ['#ff5a5f', '#ffb400', '#3ddc97', '#4cc9f0', '#b388ff', '#ff8fab'];

function spawn(p) {
  p.x = rand(60, W - 60); p.y = rand(60, H - 60);
  p.hp = 100; p.dead = 0;
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const p = {
    id, name: 'Jugador ' + id, color: COLORS[id % COLORS.length],
    x: 0, y: 0, hp: 100, dead: 0, kills: 0, deaths: 0, cd: 0,
    input: { up: false, down: false, left: false, right: false, shoot: false, angle: 0 },
  };
  spawn(p);
  players.set(id, p);
  ws.send(JSON.stringify({ t: 'hello', id, W, H }));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'input' && m.i) {
      const i = m.i;                      // validamos: nunca confiar en el cliente
      p.input = {
        up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right,
        shoot: !!i.shoot, angle: Number.isFinite(i.angle) ? i.angle : 0,
      };
    } else if (m.t === 'name' && typeof m.name === 'string') {
      p.name = m.name.slice(0, 16) || p.name;
    }
  });
  ws.on('close', () => players.delete(id));
});

// --- Bucle de juego ---
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  for (const p of players.values()) {
    if (p.dead > 0) { p.dead -= dt; if (p.dead <= 0) spawn(p); continue; }
    const { input: i } = p;
    let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    p.x = clamp(p.x + (dx / len) * SPEED * dt, RADIUS, W - RADIUS);
    p.y = clamp(p.y + (dy / len) * SPEED * dt, RADIUS, H - RADIUS);
    p.cd -= dt;
    if (i.shoot && p.cd <= 0) {
      p.cd = FIRE_COOLDOWN;
      bullets.push({
        x: p.x + Math.cos(i.angle) * RADIUS, y: p.y + Math.sin(i.angle) * RADIUS,
        vx: Math.cos(i.angle) * BULLET_SPEED, vy: Math.sin(i.angle) * BULLET_SPEED,
        life: BULLET_LIFE, owner: p.id,
      });
    }
  }

  for (let b = bullets.length - 1; b >= 0; b--) {
    const bl = bullets[b];
    bl.x += bl.vx * dt; bl.y += bl.vy * dt; bl.life -= dt;
    let remove = bl.life <= 0 || bl.x < 0 || bl.x > W || bl.y < 0 || bl.y > H;
    if (!remove) {
      for (const p of players.values()) {
        if (p.id === bl.owner || p.dead > 0) continue;
        if (Math.hypot(p.x - bl.x, p.y - bl.y) < RADIUS + 4) {
          p.hp -= BULLET_DMG; remove = true;
          if (p.hp <= 0) {
            p.dead = RESPAWN; p.deaths++;
            const killer = players.get(bl.owner); if (killer) killer.kills++;
          }
          break;
        }
      }
    }
    if (remove) bullets.splice(b, 1);
  }
}, 1000 / TICK);

// --- Difusión del estado (20 veces por segundo) ---
setInterval(() => {
  const state = JSON.stringify({
    t: 'state',
    p: [...players.values()].map(p => ({
      id: p.id, n: p.name, c: p.color, x: Math.round(p.x), y: Math.round(p.y),
      hp: p.hp, d: p.dead > 0, k: p.kills, de: p.deaths,
    })),
    b: bullets.map(b => [Math.round(b.x), Math.round(b.y)]),
  });
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(state);
}, 50);

server.listen(PORT, () => console.log(`Arena lista en http://localhost:${PORT}`));
