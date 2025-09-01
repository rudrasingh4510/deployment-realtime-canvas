const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const ACTIONS = require("./Actions");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const server = http.createServer(app);

// ---- Compiler Language Config ----
const languageConfig = {
  python3: { versionIndex: "3" },
  java: { versionIndex: "3" },
  cpp: { versionIndex: "4" },
  nodejs: { versionIndex: "3" },
  c: { versionIndex: "4" },
  ruby: { versionIndex: "3" },
  go: { versionIndex: "3" },
  scala: { versionIndex: "3" },
  bash: { versionIndex: "3" },
  sql: { versionIndex: "3" },
  pascal: { versionIndex: "2" },
  csharp: { versionIndex: "3" },
  php: { versionIndex: "3" },
  swift: { versionIndex: "3" },
  rust: { versionIndex: "3" },
  r: { versionIndex: "3" },
};

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// ---- Socket.IO Setup ----
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*", // in prod, set CLIENT_URL
    methods: ["GET", "POST"],
  },
});

const userSocketMap = {};
const roomCanvasHistory = {}; // canvas history per room
const roomCodeState = {}; // code state per room

const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => ({
      socketId,
      username: userSocketMap[socketId],
    })
  );
};

io.on("connection", (socket) => {
  // ---- Join Room ----
  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);

    const clients = getAllConnectedClients(roomId);

    // Send canvas state to newcomer
    const state = roomCanvasHistory[roomId];
    if (state) {
      socket.emit("canvas-state", {
        history: state.history,
        step: state.step,
        kind: "state",
      });
    }

    // Send code state to newcomer
    if (roomCodeState[roomId]) {
      socket.emit(ACTIONS.CODE_CHANGE, { code: roomCodeState[roomId] });
    }

    // 🔹 FIX: Notify others about new user
    socket.to(roomId).emit(ACTIONS.JOINED, {
      clients,
      username,
      socketId: socket.id,
    });

    // 🔹 Send the full client list only to the new user
    socket.emit(ACTIONS.JOINED, {
      clients,
      username,
      socketId: socket.id,
    });
  });

  // ---- Code Sync ----
  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    roomCodeState[roomId] = code;
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  // ---- Canvas Drawing ----
  socket.on("canvas-draw", ({ roomId, ...data }) => {
    if (roomId) socket.to(roomId).emit("canvas-draw", data);
  });

  // ---- Canvas State ----
  socket.on("canvas-state", ({ roomId, history, step, imgData, kind }) => {
    if (!roomId) return;

    if (Array.isArray(history) && typeof step === "number") {
      roomCanvasHistory[roomId] = { history: [...history], step };
      socket.to(roomId).emit("canvas-state", {
        history,
        step,
        kind: kind || "state",
      });
    } else if (typeof imgData === "string") {
      const prev = roomCanvasHistory[roomId] || { history: [], step: -1 };
      const cut = prev.history.slice(0, prev.step + 1);
      cut.push(imgData);
      roomCanvasHistory[roomId] = { history: cut, step: cut.length - 1 };
      socket.to(roomId).emit("canvas-state", imgData);
    }
  });

  // ---- Clear Canvas ----
  socket.on("canvas-clear", ({ roomId }) => {
    if (roomId) {
      delete roomCanvasHistory[roomId];
      socket.to(roomId).emit("canvas-clear");
    }
  });

  // ---- Disconnect ----
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });

      const remaining = getAllConnectedClients(roomId);
      if (remaining.length <= 1) {
        delete roomCanvasHistory[roomId];
        delete roomCodeState[roomId];
      }
    });
    delete userSocketMap[socket.id];
  });
});

// ---- Compiler API Proxy ----
app.post("/compile", async (req, res) => {
  const { code, language } = req.body;

  try {
    const response = await axios.post("https://api.jdoodle.com/v1/execute", {
      script: code,
      language,
      versionIndex: languageConfig[language].versionIndex,
      clientId: process.env.jDoodle_clientId,
      clientSecret: process.env.jDoodle_clientSecret,
    });
    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to compile code" });
  }
});

// ---- Serve React Frontend ----
app.use(express.static(path.join(__dirname, "..", "client", "build")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "build", "index.html"));
});

// ---- Start Server ----
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
