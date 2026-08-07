require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const meetingRoutes = require('./routes/meetings');
const Meeting = require('./models/Meeting');

const app = express();
const server = http.createServer(app);

const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const io = new Server(server, {
  cors: {
    origin: clientUrl,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: clientUrl }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vyom-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);

const roomUsers = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', async ({ roomId, userId, userName }) => {
    if (!roomId) return;

    socket.join(roomId);
    if (!roomUsers.has(roomId)) {
      roomUsers.set(roomId, new Map());
    }
    roomUsers.get(roomId).set(socket.id, { userId, userName, socketId: socket.id });

    const peers = [...roomUsers.get(roomId).values()].filter((u) => u.socketId !== socket.id);
    socket.emit('room-peers', peers);
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, userName });
  });

  socket.on('webrtc-offer', ({ roomId, targetSocketId, offer }) => {
    io.to(targetSocketId).emit('webrtc-offer', { fromSocketId: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ roomId, targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc-answer', { fromSocketId: socket.id, answer });
  });

  socket.on('webrtc-ice-candidate', ({ roomId, targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate', { fromSocketId: socket.id, candidate });
  });

  socket.on('chat-message', ({ roomId, userId, userName, message }) => {
    if (!roomId || !message?.trim()) return;
    io.to(roomId).emit('chat-message', {
      userId,
      userName,
      message: message.trim(),
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('media-state', ({ roomId, audioEnabled, videoEnabled }) => {
    socket.to(roomId).emit('media-state', { socketId: socket.id, audioEnabled, videoEnabled });
  });

  socket.on('leave-room', ({ roomId }) => {
    handleDisconnect(socket, roomId);
  });

  socket.on('disconnect', () => {
    for (const [roomId, users] of roomUsers.entries()) {
      if (users.has(socket.id)) {
        handleDisconnect(socket, roomId);
        break;
      }
    }
  });
});

function handleDisconnect(socket, roomId) {
  const users = roomUsers.get(roomId);
  if (!users) return;

  users.delete(socket.id);
  socket.to(roomId).emit('user-left', { socketId: socket.id });

  if (users.size === 0) {
    roomUsers.delete(roomId);
    Meeting.findOneAndUpdate({ roomId }, { endedAt: new Date() }).catch(() => {});
  }
}

const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vyom';

mongoose
  .connect(mongoUri)
  .then(() => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`Vyom backend listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });
