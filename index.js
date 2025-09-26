const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*', // Allow all origins for local network testing
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

const rooms = new Map();
const MAX_USERS_PER_ROOM = 20;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', (callback) => {
    const roomId = Math.random().toString(36).substring(2, 15);
    rooms.set(roomId, {
      host: socket.id,
      users: new Map([[socket.id, { id: socket.id, name: null }]]),
      maxUsers: MAX_USERS_PER_ROOM
    });
    socket.join(roomId);
    callback({ roomId });
    console.log('Room created:', roomId);
  });

  socket.on('join-room', (roomId, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }
    if (room.users.size >= room.maxUsers) {
      callback({ error: `Room is full (${room.maxUsers} users max)` });
      return;
    }
    
    room.users.set(socket.id, { id: socket.id, name: null });
    socket.join(roomId);
    
    // Notify all users in room about new user
    const usersList = Array.from(room.users.values());
    io.to(roomId).emit('users-updated', { users: usersList });
    
    // Notify new user about existing peers
    const existingPeers = Array.from(room.users.keys()).filter(id => id !== socket.id);
    callback({ success: true, isHost: socket.id === room.host, existingPeers, users: usersList });
    
    // Notify existing users about new peer
    socket.to(roomId).emit('peer-joined', { peerId: socket.id });
    
    console.log(`User joined room: ${roomId}, Total users: ${room.users.size}`);
  });

  socket.on('signal', ({ roomId, targetId, signal }) => {
    const room = rooms.get(roomId);
    if (!room) {
      console.log('Room not found:', roomId);
      return;
    }
    
    // Verify sender is in the room
    if (!room.users.has(socket.id)) {
      console.log('Sender not in room:', socket.id);
      return;
    }
    
    if (targetId) {
      // Direct message to specific target
      if (room.users.has(targetId)) {
        io.to(targetId).emit('signal', { 
          senderId: socket.id, 
          signal 
        });
        console.log('📡 Signal:', signal.type || 'unknown', 'from', socket.id, 'to', targetId);
      } else {
        console.log('❌ Target not in room:', targetId);
      }
    } else {
      // Broadcast to all other users in room (for trickle ICE)
      socket.to(roomId).emit('signal', { 
        senderId: socket.id, 
        signal 
      });
      console.log('📡 Signal broadcast:', signal.type || 'unknown', 'from', socket.id, 'to room', roomId);
    }
  });
  
  socket.on('update-user-name', ({ roomId, userName }) => {
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socket.id)) return;
    
    const user = room.users.get(socket.id);
    user.name = userName;
    
    const usersList = Array.from(room.users.values());
    io.to(roomId).emit('users-updated', { users: usersList });
    console.log(`User ${socket.id} updated name to ${userName}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        
        if (room.users.size === 0) {
          // Delete room if empty
          rooms.delete(roomId);
          console.log('Room deleted (empty):', roomId);
        } else {
          // Notify remaining users
          const usersList = Array.from(room.users.values());
          io.to(roomId).emit('users-updated', { users: usersList });
          io.to(roomId).emit('peer-disconnected', { peerId: socket.id });
          
          // If host left, assign new host
          if (room.host === socket.id && room.users.size > 0) {
            const newHost = room.users.keys().next().value;
            room.host = newHost;
            io.to(roomId).emit('host-changed', { newHost });
            console.log(`Host changed in room ${roomId} to ${newHost}`);
          }
          
          console.log(`User left room: ${roomId}, Remaining users: ${room.users.size}`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});