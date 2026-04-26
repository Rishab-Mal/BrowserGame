require('dotenv').config();
const express          = require('express');
const { createServer } = require('http');
const { Server }       = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path             = require('path');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const GRID = 100;
const HEX  = /^#[0-9a-fA-F]{6}$/;

// ── Static files ───────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/gsap-public', express.static(path.join(__dirname, 'gsap-public')));

// ── Pixel cache ────────────────────────────────────────────
// Holds the full canvas state in memory so new connections
// get the current board instantly without hitting the DB.
const cache = new Map(); // 'x,y' → { x, y, color }

async function loadCache() {
  const { data, error } = await db.from('pixels').select('x, y, color');
  if (error) { console.error('DB load error:', error.message); return; }
  (data || []).forEach(p => cache.set(`${p.x},${p.y}`, p));
  console.log(`Loaded ${cache.size} pixels from DB`);
}

// ── Batched DB writes ──────────────────────────────────────
const writeQueue = new Map();
let writeTimer   = null;

function queueWrite(x, y, color) {
  writeQueue.set(`${x},${y}`, { x, y, color });
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    const rows = [...writeQueue.values()];
    writeQueue.clear();
    if (!rows.length) return;
    const { error } = await db.from('pixels').upsert(rows, { onConflict: 'x,y' });
    if (error) console.error('DB write error:', error.message);
  }, 150);
}

// ── Socket.IO ──────────────────────────────────────────────
io.on('connection', socket => {
  // Send full board state to the new client
  socket.emit('init', [...cache.values()]);

  socket.on('paint', ({ x, y, color }) => {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || x >= GRID || y < 0 || y >= GRID)    return;
    if (typeof color !== 'string' || !HEX.test(color)) return;

    cache.set(`${x},${y}`, { x, y, color });
    queueWrite(x, y, color);
    socket.broadcast.emit('paint', { x, y, color });
  });
});

// ── Boot ───────────────────────────────────────────────────
loadCache().then(() => {
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => console.log(`pixelboard on :${PORT}`));
});
