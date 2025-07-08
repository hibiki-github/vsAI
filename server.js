// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// ==== マッチング用部屋管理 ====
const ROOM_NAMES = ['room1', 'room2', 'room3', 'room4'];
// 各部屋の参加socket.idを管理
let rooms = {
  room1: [],
  room2: [],
  room3: [],
  room4: []
};

// 各部屋ごとに再戦希望者リスト(rematchRequests)を管理
let rematchRequests = {
  room1: [],
  room2: [],
  room3: [],
  room4: []
};
// 各部屋ごとに完成ボタン押下者リストを管理
let finishRequests = {
  room1: [],
  room2: [],
  room3: [],
  room4: []
};

// 各部屋ごとにユーザー名を管理
let userNames = {
  room1: {},
  room2: {},
  room3: {},
  room4: {}
};
// 各部屋ごとにユーザーアイコンを管理
let userIcons = {
  room1: {},
  room2: {},
  room3: {},
  room4: {}
};

// 部屋の状態を全クライアントに通知
function broadcastRoomStatus() {
  const status = {};
  for (const room of ROOM_NAMES) {
    status[room] = rooms[room].length;
  }
  io.emit('room_status', status);
}

// 両者の名前・アイコンが揃ってからroom_readyをemitする
function tryEmitRoomReady(roomName) {
  if (rooms[roomName].length === 2) {
    const ids = rooms[roomName];
    const names = userNames[roomName];
    const icons = userIcons[roomName];
    if (!names[ids[0]] || !names[ids[1]] || !icons[ids[0]] || !icons[ids[1]]
      || names[ids[0]] === '' || names[ids[1]] === ''
      || icons[ids[0]] === '' || icons[ids[1]] === '') {
      setTimeout(() => tryEmitRoomReady(roomName), 50);
      return;
    }
    const hostId = ids[0];
    io.to(roomName).emit('room_ready', { room: roomName, hostId, names: { ...names }, icons: { ...icons } });
  }
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // 部屋一覧リクエスト
  socket.on('get_rooms', () => {
    const status = {};
    for (const room of ROOM_NAMES) {
      status[room] = rooms[room].length;
    }
    socket.emit('room_status', status);
  });

  // 部屋入室リクエスト
  socket.on('join_room', (data) => {
    const roomName = data.roomName;
    const name = data.name || '名無し';
    const icon = data.icon || '👤';
    if (!ROOM_NAMES.includes(roomName)) return;
    // すでに入っていれば何もしない
    if (rooms[roomName].includes(socket.id)) return;
    // 2人まで
    if (rooms[roomName].length >= 2) return;
    // 他の部屋からは抜ける＋切断済みID除去
    for (const r of ROOM_NAMES) {
      const idx = rooms[r].indexOf(socket.id);
      if (idx !== -1) rooms[r].splice(idx, 1);
      socket.leave(r);
      rooms[r] = rooms[r].filter(id => io.sockets.sockets.get(id));
      if (userIcons[r][socket.id]) delete userIcons[r][socket.id];
    }
    // この部屋に入る前に切断済みID除去
    rooms[roomName] = rooms[roomName].filter(id => io.sockets.sockets.get(id));
    rooms[roomName].push(socket.id);
    socket.join(roomName);
    // ユーザー名・アイコンを同時にセット
    userNames[roomName][socket.id] = name;
    userIcons[roomName][socket.id] = icon;
    broadcastRoomStatus();
    // 2人揃ったら両者の名前・アイコンが揃うまで待ってemit
    if (rooms[roomName].length === 2) {
      tryEmitRoomReady(roomName);
    }
  });

  // 再戦リクエスト
  socket.on('rematch_request', (roomName) => {
    if (!ROOM_NAMES.includes(roomName)) return;
    if (!rooms[roomName].includes(socket.id)) return;
    if (!rematchRequests[roomName].includes(socket.id)) {
      rematchRequests[roomName].push(socket.id);
    }
    // 相手に再戦希望通知
    rooms[roomName].forEach(id => {
      if (id !== socket.id) {
        io.to(id).emit('rematch_notice');
      }
    });
    // 2人揃ったら再度room_ready（ホストIDも渡す）
    if (rematchRequests[roomName].length === 2) {
      rooms[roomName] = rooms[roomName].filter(id => io.sockets.sockets.get(id));
      tryEmitRoomReady(roomName);
      rematchRequests[roomName] = [];
    }
  });

  // 完成ボタン押下
  socket.on('finish_request', (roomName) => {
    if (!ROOM_NAMES.includes(roomName)) return;
    if (!rooms[roomName].includes(socket.id)) return;
    if (!finishRequests[roomName].includes(socket.id)) {
      finishRequests[roomName].push(socket.id);
    }
    // 相手に完成通知
    rooms[roomName].forEach(id => {
      if (id !== socket.id) {
        io.to(id).emit('finish_notice');
      }
    });
    // 2人揃ったら両者にresult_readyをemit
    if (finishRequests[roomName].length === 2) {
      io.to(roomName).emit('result_ready');
      finishRequests[roomName] = [];
    }
  });

  // 切断時に部屋から除外
  socket.on('disconnect', () => {
    for (const room of ROOM_NAMES) {
      const idx = rooms[room].indexOf(socket.id);
      if (idx !== -1) rooms[room].splice(idx, 1);
      const rIdx = rematchRequests[room].indexOf(socket.id);
      if (rIdx !== -1) rematchRequests[room].splice(rIdx, 1);
      const fIdx = finishRequests[room].indexOf(socket.id);
      if (fIdx !== -1) finishRequests[room].splice(fIdx, 1);
      if (userNames[room][socket.id]) delete userNames[room][socket.id];
      if (userIcons[room][socket.id]) delete userIcons[room][socket.id];
    }
    broadcastRoomStatus();
    console.log('A user disconnected:', socket.id);
  });

  // お題リレー
  socket.on('send_topic', (data) => {
    if (!data.room || !data.topic) return;
    // 部屋全員にお題を配信
    io.to(data.room).emit('receive_topic', data.topic);
  });

  // 描画データリレー
  socket.on('draw', (data) => {
    if (!data.room) return;
    socket.to(data.room).emit('draw', data);
  });

  // 判定・結果リレー（必要に応じて拡張）
  socket.on('result', (data) => {
    if (!data.room) return;
    socket.to(data.room).emit('result', data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
