const express          = require('express');
const { createServer } = require('http');
const { Server }       = require('socket.io');
const path             = require('path');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/gsap-public', express.static(path.join(__dirname, 'gsap-public')));

// In-memory spray history — new connections replay this to see current wall state
const MAX    = 25000;
const history = [];
const HEX    = /^#[0-9a-fA-F]{6}$/;

io.on('connection', socket => {
  socket.emit('init', history);

  socket.on('spray', ({ x, y, color, size, seed }) => {
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (typeof size !== 'number' || size < 4 || size > 80) return;
    if (typeof color !== 'string' || !HEX.test(color)) return;
    if (typeof seed !== 'number') return;

    const ev = { x, y, color, size, seed };
    history.push(ev);
    if (history.length > MAX) history.shift();
    socket.broadcast.emit('spray', ev);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`graffiti wall on :${PORT}`));
