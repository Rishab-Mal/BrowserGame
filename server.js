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

// ── In-memory caches ───────────────────────────────────────
const MAX         = 50000;
const history     = [];   // spray strokes
const textHistory = [];   // text items

// ── Load from DB ───────────────────────────────────────────
async function loadHistory() {
  const { data, error } = await db
    .from('strokes')
    .select('x, y, color, size, seed')
    .order('id', { ascending: true })
    .limit(MAX);
  if (error) { console.error('strokes load error:', error.message); return; }
  history.push(...(data || []));
  console.log(`Loaded ${history.length} strokes`);
}

async function loadTexts() {
  const { data, error } = await db
    .from('text_items')
    .select('x, y, text, color, size')
    .order('id', { ascending: true })
    .limit(10000);
  if (error) { console.error('text_items load error:', error.message); return; }
  textHistory.push(...(data || []));
  console.log(`Loaded ${textHistory.length} text items`);
}

// ── Batch DB writes ────────────────────────────────────────
function batchWriter(table) {
  const queue = [];
  let timer = null;
  return function enqueue(row) {
    queue.push(row);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const rows = queue.splice(0);
      if (!rows.length) return;
      const { error } = await db.from(table).insert(rows);
      if (error) console.error(`${table} write error:`, error.message);
    }, 200);
  };
}

const queueStroke = batchWriter('strokes');
const queueText   = batchWriter('text_items');

// ── Socket.IO ──────────────────────────────────────────────
io.on('connection', socket => {
  socket.emit('init',       history);
  socket.emit('init_texts', textHistory);

  socket.on('spray', ({ x, y, color, size, seed }) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (typeof size !== 'number' || size < 4 || size > 80) return;
    if (typeof color !== 'string' || !HEX.test(color))    return;
    if (typeof seed !== 'number') return;

    const stroke = { x, y, color, size, seed };
    history.push(stroke);
    if (history.length > MAX) history.shift();
    queueStroke(stroke);
    socket.broadcast.emit('spray', stroke);
  });

  socket.on('text', ({ x, y, text, color, size }) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (typeof text !== 'string' || !text.trim() || text.length > 200) return;
    if (typeof color !== 'string' || !HEX.test(color)) return;
    if (typeof size !== 'number' || size < 4 || size > 80) return;

    const item = { x, y, text: text.trim(), color, size };
    textHistory.push(item);
    queueText(item);
    socket.broadcast.emit('text', item);
  });
});

// ── Boot ───────────────────────────────────────────────────
Promise.all([loadHistory(), loadTexts()]).then(() => {
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => console.log(`graffiti wall on :${PORT}`));
});
