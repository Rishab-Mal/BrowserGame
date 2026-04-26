require('dotenv').config();
const express          = require('express');
const { createServer } = require('http');
const { Server }       = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path             = require('path');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);

const db  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const HEX = /^#[0-9a-fA-F]{6}$/;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/gsap-public', express.static(path.join(__dirname, 'gsap-public')));

// ── In-memory cache ────────────────────────────────────────
const MAX     = 50000;
const history = [];

// ── Load from DB on startup ────────────────────────────────
async function loadHistory() {
  const { data, error } = await db
    .from('strokes')
    .select('x, y, color, size, seed')
    .order('id', { ascending: true })
    .limit(MAX);

  if (error) { console.error('DB load error:', error.message); return; }
  history.push(...(data || []));
  console.log(`Loaded ${history.length} strokes from DB`);
}

// ── Batch DB writes ────────────────────────────────────────
const writeQueue = [];
let writeTimer   = null;

function queueWrite(stroke) {
  writeQueue.push(stroke);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    const rows = writeQueue.splice(0);
    if (!rows.length) return;
    const { error } = await db.from('strokes').insert(rows);
    if (error) console.error('DB write error:', error.message);
  }, 200);
}

// ── Socket.IO ──────────────────────────────────────────────
io.on('connection', socket => {
  socket.emit('init', history);

  socket.on('spray', ({ x, y, color, size, seed }) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (typeof size !== 'number' || size < 4 || size > 80) return;
    if (typeof color !== 'string' || !HEX.test(color))    return;
    if (typeof seed !== 'number') return;

    const stroke = { x, y, color, size, seed };
    history.push(stroke);
    if (history.length > MAX) history.shift();
    queueWrite(stroke);
    socket.broadcast.emit('spray', stroke);
  });
});

// ── Boot ───────────────────────────────────────────────────
loadHistory().then(() => {
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => console.log(`graffiti wall on :${PORT}`));
});
