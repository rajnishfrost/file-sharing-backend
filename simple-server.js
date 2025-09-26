const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeRooms: rooms.size,
    totalVisitors: totalVisitors,
    activeUsers: activeUsers,
    message: 'Server is running'
  });
});

// User visit tracking endpoint
app.post('/track-visit', (req, res) => {
  const { sessionId } = req.body;
  
  // Only count unique sessions
  if (sessionId && !userSessions.has(sessionId)) {
    userSessions.add(sessionId);
    totalVisitors++;
    console.log(`New visitor tracked. Total visitors: ${totalVisitors}`);
  }
  
  res.status(200).json({
    success: true,
    totalVisitors: totalVisitors,
    activeUsers: activeUsers
  });
});

// Store rooms with only 2 users max
const rooms = new Map();

// User tracking
let totalVisitors = 0;
let activeUsers = 0;
const userSessions = new Set(); // Track unique sessions

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Track active user
  activeUsers++;
  console.log(`Active users: ${activeUsers}`);
  
  let currentRoom = null;

  socket.on('create-room', () => {
    // Generate simple room ID
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    rooms.set(roomId, {
      users: [socket.id],
      created: Date.now()
    });
    
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log('Room created:', roomId);
  });

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' });
      return;
    }
    
    if (room.users.length >= 2) {
      socket.emit('room-error', { message: 'Room is full' });
      return;
    }
    
    room.users.push(socket.id);
    currentRoom = roomId;
    socket.join(roomId);
    
    // Notify the first user that someone joined
    socket.to(roomId).emit('peer-joined');
    
    // Notify the joiner
    socket.emit('room-joined', { roomId });
    
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('signal', ({ roomId, signal }) => {
    if (roomId && rooms.has(roomId)) {
      // Send signal to the other user in the room
      socket.to(roomId).emit('signal', { signal });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Track active user disconnect
    activeUsers = Math.max(0, activeUsers - 1);
    console.log(`Active users: ${activeUsers}`);
    
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users = room.users.filter(id => id !== socket.id);
        
        if (room.users.length === 0) {
          // Delete empty room
          rooms.delete(currentRoom);
          console.log('Room deleted:', currentRoom);
        } else {
          // Notify remaining user
          io.to(currentRoom).emit('peer-left');
        }
      }
    }
  });
});

// Clean up old empty rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.users.length === 0 && now - room.created > 5 * 60 * 1000) {
      rooms.delete(roomId);
      console.log('Cleaned up old room:', roomId);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all interfaces

server.listen(PORT, HOST, () => {
  console.log(`Simple server running on ${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  if (HOST === '0.0.0.0') {
    console.log('Server accessible from other devices on the network');
  }
});