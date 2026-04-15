const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const MAX_CONTROLLERS = 4;
const sessions = new Map();

function makeSession() {
  const id = crypto.randomBytes(4).toString("hex");
  const session = {
    id,
    hostId: null,
    status: "waiting",
    menuIndex: 0,
    selectedGame: "pulse-pit",
    controllers: [],
    inputs: {}
  };
  sessions.set(id, session);
  return session;
}

function sessionPayload(session) {
  return {
    id: session.id,
    status: session.status,
    menuIndex: session.menuIndex,
    selectedGame: session.selectedGame,
    players: session.controllers.map((player) => ({
      id: player.id,
      slot: player.slot,
      label: player.label
    }))
  };
}

function localIpv4Address() {
  const nets = os.networkInterfaces();
  for (const group of Object.values(nets)) {
    for (const net of group || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

function joinBaseUrl(req) {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || req.protocol;
  const host = req.get("host") || `localhost:${PORT}`;
  const hostname = host.split(":")[0];

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const localIp = localIpv4Address();
    if (localIp) {
      return `${protocol}://${localIp}:${PORT}`;
    }
  }

  return `${protocol}://${host}`;
}

function joinUrl(req, sessionId) {
  return `${joinBaseUrl(req)}/controller.html?session=${sessionId}`;
}

function reindexControllers(session) {
  session.controllers.forEach((player, index) => {
    player.slot = index + 1;
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/session", async (req, res) => {
  const session = makeSession();
  const url = joinUrl(req, session.id);
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 320
  });

  res.json({
    sessionId: session.id,
    joinUrl: url,
    qrDataUrl,
    requiresSameNetwork: !PUBLIC_BASE_URL
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, sessions: sessions.size, publicBaseUrl: PUBLIC_BASE_URL || null });
});

io.on("connection", (socket) => {
  socket.on("host:join", ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit("session:error", { message: "Room not found." });
      return;
    }

    session.hostId = socket.id;
    socket.data.sessionId = sessionId;
    socket.data.role = "host";
    socket.join(session.id);
    socket.emit("session:state", sessionPayload(session));
  });

  socket.on("host:update-session", ({ sessionId, patch }) => {
    const session = sessions.get(sessionId);
    if (!session || session.hostId !== socket.id) return;

    if (typeof patch.status === "string") session.status = patch.status;
    if (typeof patch.menuIndex === "number") session.menuIndex = patch.menuIndex;
    if (typeof patch.selectedGame === "string") session.selectedGame = patch.selectedGame;

    io.to(session.id).emit("session:state", sessionPayload(session));
  });

  socket.on("host:controller-view", ({ sessionId, targetId, view }) => {
    const session = sessions.get(sessionId);
    if (!session || session.hostId !== socket.id) return;
    io.to(targetId).emit("controller:view", view);
  });

  socket.on("host:broadcast-view", ({ sessionId, view }) => {
    const session = sessions.get(sessionId);
    if (!session || session.hostId !== socket.id) return;
    for (const player of session.controllers) {
      io.to(player.id).emit("controller:view", view[player.id] || view.default || null);
    }
  });

  socket.on("controller:join", ({ sessionId, nickname }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit("session:error", { message: "Room not found." });
      return;
    }

    if (session.controllers.length >= MAX_CONTROLLERS) {
      socket.emit("session:error", { message: "This room already has four players." });
      return;
    }

    const existing = session.controllers.find((player) => player.id === socket.id);
    if (existing) {
      socket.emit("controller:accepted", {
        playerId: existing.id,
        slot: existing.slot,
        label: existing.label
      });
      return;
    }

    const slot = session.controllers.length + 1;
    const label = (nickname || "").trim() || `Player ${slot}`;
    const controller = { id: socket.id, slot, label };
    session.controllers.push(controller);
    session.inputs[socket.id] = {
      moveX: 0,
      moveY: 0,
      aimX: slot === 1 ? 1 : -1,
      aimY: 0,
      firing: false,
      dashing: false,
      menuConfirm: false,
      menuPrev: false,
      menuNext: false,
      menuQuit: false
    };

    if (session.status === "waiting") {
      session.status = "menu";
    }

    socket.data.sessionId = sessionId;
    socket.data.role = "controller";
    socket.join(session.id);
    socket.emit("controller:accepted", {
      playerId: socket.id,
      slot,
      label
    });

    io.to(session.id).emit("session:state", sessionPayload(session));
  });

  socket.on("controller:input", ({ sessionId, input }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.inputs[socket.id]) {
      return;
    }

    session.inputs[socket.id] = {
      ...session.inputs[socket.id],
      ...input
    };

    io.to(session.id).emit("input:update", {
      playerId: socket.id,
      input: session.inputs[socket.id]
    });
  });

  socket.on("controller:action", ({ sessionId, action }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.inputs[socket.id]) return;
    if (!session.hostId) return;
    io.to(session.hostId).emit("controller:action", {
      playerId: socket.id,
      action
    });
  });

  socket.on("disconnect", () => {
    for (const session of sessions.values()) {
      if (session.hostId === socket.id) {
        io.to(session.id).emit("session:error", { message: "Host disconnected." });
        sessions.delete(session.id);
        continue;
      }

      const playerIndex = session.controllers.findIndex((player) => player.id === socket.id);
      if (playerIndex !== -1) {
        session.controllers.splice(playerIndex, 1);
        delete session.inputs[socket.id];
        reindexControllers(session);
        if (session.controllers.length === 0) {
          session.status = "waiting";
        }
        io.to(session.id).emit("session:state", sessionPayload(session));
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ZEST is running at http://localhost:${PORT}`);
  const localIp = localIpv4Address();
  if (localIp) {
    console.log(`Phones on the same Wi-Fi can use: http://${localIp}:${PORT}`);
  }
  if (PUBLIC_BASE_URL) {
    console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  }
});
