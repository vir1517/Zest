const socket = io();

const qrImage = document.getElementById("qrImage");
const roomCode = document.getElementById("roomCode");
const joinUrl = document.getElementById("joinUrl");
const playerStatus = document.getElementById("playerStatus");
const menuList = document.getElementById("menuList");
const overlay = document.getElementById("overlay");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Helper: roundRect for canvas
CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  this.moveTo(x + r, y);
  this.lineTo(x + w - r, y);
  this.quadraticCurveTo(x + w, y, x + w, y + r);
  this.lineTo(x + w, y + h - r);
  this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  this.lineTo(x + r, y + h);
  this.quadraticCurveTo(x, y + h, x, y + h - r);
  this.lineTo(x, y + r);
  this.quadraticCurveTo(x, y, x + r, y);
  return this;
};

const MENU_GAMES = [
  {
    id: "pulse-pit",
    title: "Pulse Pit",
    subtitle: "Fast 2D arena duel",
    description: "Twin-stick arena combat with hazards, pickups, and solo bot support.",
    minPlayers: 1,
    maxPlayers: 2
  },
  {
    id: "uno",
    title: "UNO",
    subtitle: "2-4 player card table",
    description: "Classic color-match chaos with hands shown privately on each phone.",
    minPlayers: 2,
    maxPlayers: 4
  }
];

const MATCH_POINT = 5;
const WORLD = { width: 1600, height: 900 };
const PLAYER_RADIUS = 22;
const PLAYER_SPEED = 360;
const DASH_SPEED = 860;
const DASH_TIME = 0.16;
const DASH_COOLDOWN = 1.2;
const SHOT_SPEED = 980;
const SHOT_LIFE = 1.05;
const FIRE_COOLDOWN = 0.11;
const PICKUP_DELAY = 6;
const PICKUP_RADIUS = 15;
const BOT_ID = "bot";
const UNO_COLORS = ["red", "yellow", "green", "blue"];
const UNO_COLOR_CSS = {
  red: "#ff5f8f",
  yellow: "#ffc857",
  green: "#4dde91",
  blue: "#44d7ff",
  wild: "#2a314a"
};

const obstacleLayout = [
  { x: 260, y: 160, w: 120, h: 220 },
  { x: 1220, y: 160, w: 120, h: 220 },
  { x: 520, y: 220, w: 170, h: 70 },
  { x: 910, y: 220, w: 170, h: 70 },
  { x: 695, y: 120, w: 210, h: 70 },
  { x: 700, y: 710, w: 200, h: 70 },
  { x: 450, y: 565, w: 140, h: 85 },
  { x: 1010, y: 565, w: 140, h: 85 },
  { x: 705, y: 355, w: 190, h: 185 },
  { x: 190, y: 660, w: 180, h: 72 },
  { x: 1230, y: 660, w: 180, h: 72 }
];

const pickupSpawns = [
  { x: 155, y: 130 },
  { x: 1440, y: 130 },
  { x: 155, y: 780 },
  { x: 1440, y: 780 },
  { x: 800, y: 90 },
  { x: 800, y: 810 },
  { x: 800, y: 650 },
  { x: 800, y: 250 }
];

const host = {
  sessionId: null,
  state: {
    status: "waiting",
    players: [],
    menuIndex: 0,
    selectedGame: MENU_GAMES[0].id
  },
  inputs: {},
  game: null,
  currentMode: "shelf",
  viewport: {
    width: 1280,
    height: 720
  }
};

let audioContext = null;

function ensureAudio() {
  if (audioContext || typeof window === "undefined") return audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext = new AudioContextClass();
  return audioContext;
}

function playTone(frequency, duration, type = "sine", gainValue = 0.03) {
  const audio = ensureAudio();
  if (!audio || audio.state === "suspended") return;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.78), now + duration);
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  host.viewport.width = rect.width || 1280;
  host.viewport.height = rect.height || 720;
  canvas.width = host.viewport.width * dpr;
  canvas.height = host.viewport.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(x, y) {
  const mag = Math.hypot(x, y);
  if (!mag) return { x: 0, y: 0 };
  return { x: x / mag, y: y / mag };
}

function randFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function showOverlay(title, body) {
  overlay.innerHTML = `
    <div class="overlay-card">
      <h2>${title}</h2>
      <p>${body}</p>
    </div>
  `;
}

function hideOverlay() {
  overlay.innerHTML = "";
}

function setPlayingMode(isPlaying) {
  document.body.classList.toggle("playing", isPlaying);
  resizeCanvas();
}

function getSelectedGame() {
  return MENU_GAMES[host.state.menuIndex] || MENU_GAMES[0];
}

function effectivePlayers() {
  if (host.state.selectedGame === "pulse-pit" && host.state.players.length === 1) {
    return [...host.state.players, { id: BOT_ID, label: "ZEST Bot", slot: 2, bot: true }];
  }
  return [...host.state.players];
}

function renderPlayers() {
  const visiblePlayers = effectivePlayers();
  const chips = new Array(Math.max(2, visiblePlayers.length || 2)).fill(null).map((_, index) => {
    const player = visiblePlayers[index];
    return {
      label: player?.label || `Player ${index + 1} waiting`,
      live: Boolean(player)
    };
  });

  playerStatus.innerHTML = chips
    .map((chip) => `<div class="status-chip ${chip.live ? "live" : ""}">${chip.label}</div>`)
    .join("");
}

// Updated renderMenu for AirConsole-style game cards
function renderMenu() {
  menuList.innerHTML = MENU_GAMES.map((game, index) => {
    const selected = index === host.state.menuIndex ? "selected" : "";
    const thumbIcon = game.id === "pulse-pit" ? "⚡" : "🃏";
    return `
      <article class="game-card ${selected}" data-game-id="${game.id}">
        <div class="game-thumb">${thumbIcon}</div>
        <h3>${game.title}</h3>
        <div class="game-meta">
          <span class="game-players">${game.minPlayers}-${game.maxPlayers}p</span>
          <span class="game-subtitle">${game.subtitle}</span>
        </div>
        <p class="game-desc">${game.description}</p>
      </article>
    `;
  }).join("");

  // Add click handlers to select games
  document.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.dataset.gameId;
      const idx = MENU_GAMES.findIndex(g => g.id === gameId);
      if (idx !== -1 && idx !== host.state.menuIndex) {
        host.state.menuIndex = idx;
        host.state.selectedGame = gameId;
        updateSession({ menuIndex: idx, selectedGame: gameId });
        renderMenu();
        sendArcadeViews(`Selected ${MENU_GAMES[idx].title}. Press START to launch.`);
      }
    });
  });
}

function updateSession(patch) {
  if (typeof patch.menuIndex === "number") {
    host.state.menuIndex = patch.menuIndex;
    host.state.selectedGame = MENU_GAMES[patch.menuIndex]?.id || host.state.selectedGame;
  }
  if (typeof patch.selectedGame === "string") {
    host.state.selectedGame = patch.selectedGame;
    const idx = MENU_GAMES.findIndex((game) => game.id === patch.selectedGame);
    if (idx !== -1) host.state.menuIndex = idx;
  }
  if (typeof patch.status === "string") {
    host.state.status = patch.status;
  }
  socket.emit("host:update-session", { sessionId: host.sessionId, patch });
}

function sendControllerViews(viewMap) {
  socket.emit("host:broadcast-view", { sessionId: host.sessionId, view: viewMap });
}

function sendArcadeViews(hint) {
  const viewMap = { default: { mode: "arcade", arcadeHint: hint } };
  sendControllerViews(viewMap);
}

function createPlayer(base, tint, x, y, aimX, isBot = false) {
  return {
    id: base.id,
    label: base.label,
    tint,
    x,
    y,
    radius: PLAYER_RADIUS,
    hp: 100,
    score: 0,
    aimX,
    aimY: 0,
    fireCooldown: 0,
    dashCooldown: 0,
    dashTimer: 0,
    shieldTimer: 0.45,
    rapidTimer: 0,
    trail: [],
    pulse: Math.random() * Math.PI * 2,
    flash: 0,
    speedBoostTimer: 0,
    isBot,
    botStrafeSeed: Math.random() > 0.5 ? 1 : -1,
    botDecisionTimer: 0
  };
}

function createPulsePit() {
  const roster = effectivePlayers();
  const player1 = roster[0] || { id: "p1", label: "Player 1" };
  const player2 = roster[1] || { id: BOT_ID, label: "ZEST Bot", bot: true };
  host.game = {
    type: "pulse-pit",
    phase: "playing",
    roundWinnerId: null,
    countdownUntil: 0,
    lastTime: performance.now(),
    particles: [],
    bullets: [],
    pickups: [],
    pickupTimer: PICKUP_DELAY,
    obstacles: obstacleLayout.map((shape) => ({ ...shape })),
    quake: 0,
    hazard: { x: 800, y: 450, radius: 26, angle: 0, orbitX: 230, orbitY: 120, damageTick: 0 },
    speedRing: { x: 800, y: 450, radius: 92, pulse: 0 },
    players: [
      createPlayer(player1, "#44d7ff", 160, 450, 1, player1.id === BOT_ID),
      createPlayer(player2, "#ff5f8f", 1440, 450, -1, player2.id === BOT_ID)
    ]
  };
  host.currentMode = "pulse-pit";
}

function syncPulsePitRoster() {
  if (!host.game || host.game.type !== "pulse-pit") return;
  const desiredBot = host.state.players.length === 1;
  const hasBot = host.game.players.some((player) => player.isBot);
  if (desiredBot === hasBot) return;
  const scores = host.game.players.map((player) => player.score);
  createPulsePit();
  host.game.players[0].score = scores[0] || 0;
  host.game.players[1].score = scores[1] || 0;
}

function resetPulsePitRound() {
  const scores = host.game.players.map((player) => player.score);
  createPulsePit();
  host.game.players[0].score = scores[0];
  host.game.players[1].score = scores[1];
}

function getShooterInput(playerId) {
  return host.inputs[playerId] || {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    firing: false,
    dashing: false
  };
}

function obstacleIntersectsCircle(obstacle, x, y, radius) {
  const nearestX = clamp(x, obstacle.x, obstacle.x + obstacle.w);
  const nearestY = clamp(y, obstacle.y, obstacle.y + obstacle.h);
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}

function canOccupy(x, y, radius) {
  if (!host.game || host.game.type !== "pulse-pit") return false;
  if (x - radius < 36 || x + radius > WORLD.width - 36 || y - radius < 36 || y + radius > WORLD.height - 36) {
    return false;
  }
  if (Math.hypot(x - host.game.hazard.x, y - host.game.hazard.y) < radius + host.game.hazard.radius) {
    return false;
  }
  return !host.game.obstacles.some((obstacle) => obstacleIntersectsCircle(obstacle, x, y, radius));
}

function movePlayer(player, vx, vy, delta) {
  const nextX = player.x + vx * delta;
  const nextY = player.y + vy * delta;
  if (canOccupy(nextX, player.y, player.radius)) player.x = nextX;
  if (canOccupy(player.x, nextY, player.radius)) player.y = nextY;
}

function spawnParticles(x, y, color, amount = 12, speed = 220) {
  if (!host.game || host.game.type !== "pulse-pit") return;
  for (let i = 0; i < amount; i += 1) {
    const angle = (Math.PI * 2 * i) / amount + Math.random() * 0.3;
    const velocity = speed * (0.6 + Math.random() * 0.8);
    host.game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life: 0.25 + Math.random() * 0.25,
      color,
      size: 2 + Math.random() * 4
    });
  }
}

function lineIntersectsObstacle(x1, y1, x2, y2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const sampleX = x1 + (x2 - x1) * t;
    const sampleY = y1 + (y2 - y1) * t;
    if (
      sampleX < 24 || sampleX > WORLD.width - 24 || sampleY < 24 || sampleY > WORLD.height - 24 ||
      Math.hypot(sampleX - host.game.hazard.x, sampleY - host.game.hazard.y) < host.game.hazard.radius ||
      host.game.obstacles.some((obstacle) => obstacleIntersectsCircle(obstacle, sampleX, sampleY, 3))
    ) {
      return true;
    }
  }
  return false;
}

function spawnPickup() {
  const available = pickupSpawns.filter((spawn) =>
    !host.game.pickups.some((pickup) => Math.hypot(pickup.x - spawn.x, pickup.y - spawn.y) < 40) &&
    !host.game.players.some((player) => Math.hypot(player.x - spawn.x, player.y - spawn.y) < 90)
  );
  const spawn = randFrom(available.length ? available : pickupSpawns);
  const type = Math.random() > 0.5 ? "heal" : "rapid";
  host.game.pickups.push({ x: spawn.x, y: spawn.y, type, radius: PICKUP_RADIUS, pulse: 0 });
}

function applyPickup(player, pickup) {
  if (pickup.type === "heal") {
    player.hp = Math.min(100, player.hp + 35);
    player.shieldTimer = Math.max(player.shieldTimer, 0.2);
  }
  if (pickup.type === "rapid") player.rapidTimer = 4;
  spawnParticles(pickup.x, pickup.y, pickup.type === "heal" ? "#4dde91" : "#ffc857", 10, 180);
}

function fireBullet(player) {
  const aim = normalize(player.aimX, player.aimY);
  if (!aim.x && !aim.y) return;
  const startX = player.x + aim.x * (player.radius + 10);
  const startY = player.y + aim.y * (player.radius + 10);
  host.game.bullets.push({ ownerId: player.id, x: startX, y: startY, vx: aim.x * SHOT_SPEED, vy: aim.y * SHOT_SPEED, life: SHOT_LIFE, color: player.tint, radius: 6 });
  spawnParticles(startX, startY, player.tint, 6, 120);
}

function finishPulsePitRound(winnerId, loser) {
  const winner = host.game.players.find((player) => player.id === winnerId);
  if (!winner) return;
  winner.score += 1;
  host.game.phase = winner.score >= MATCH_POINT ? "match-over" : "round-over";
  host.game.roundWinnerId = winnerId;
  host.game.countdownUntil = performance.now() + 1600;
  host.game.quake = 0.5;
  spawnParticles(loser.x, loser.y, loser.tint, 22, 280);
  playTone(winner.score >= MATCH_POINT ? 240 : 360, 0.18, "square", 0.035);
}

function updateHazard(delta) {
  host.game.hazard.angle += delta * 0.9;
  host.game.hazard.x = 800 + Math.cos(host.game.hazard.angle) * host.game.hazard.orbitX;
  host.game.hazard.y = 450 + Math.sin(host.game.hazard.angle * 1.6) * host.game.hazard.orbitY;
  host.game.hazard.damageTick -= delta;
  if (host.game.hazard.damageTick <= 0) {
    host.game.players.forEach((player) => {
      if (Math.hypot(player.x - host.game.hazard.x, player.y - host.game.hazard.y) < player.radius + host.game.hazard.radius + 2) {
        player.hp -= 10;
        player.flash = 0.12;
        host.game.quake = Math.max(host.game.quake, 0.14);
        spawnParticles(player.x, player.y, "#ffc857", 8, 180);
        if (player.hp <= 0) {
          const other = host.game.players.find((candidate) => candidate.id !== player.id);
          if (other) finishPulsePitRound(other.id, player);
        }
      }
    });
    host.game.hazard.damageTick = 0.18;
  }
}

function updateSpeedRing(delta) {
  host.game.speedRing.pulse += delta * 2.8;
  host.game.players.forEach((player) => {
    const inside = Math.hypot(player.x - host.game.speedRing.x, player.y - host.game.speedRing.y) < host.game.speedRing.radius;
    player.speedBoostTimer = inside ? 0.12 : Math.max(0, player.speedBoostTimer - delta);
  });
}

function updateBotInput(bot, target, delta) {
  const toTargetX = target.x - bot.x;
  const toTargetY = target.y - bot.y;
  const distance = Math.hypot(toTargetX, toTargetY) || 1;
  const aim = { x: toTargetX / distance, y: toTargetY / distance };
  const perpendicular = { x: -aim.y, y: aim.x };
  bot.botDecisionTimer -= delta;
  if (bot.botDecisionTimer <= 0) {
    bot.botDecisionTimer = 0.75 + Math.random() * 0.6;
    bot.botStrafeSeed = Math.random() > 0.5 ? 1 : -1;
  }
  let moveX = aim.x * 0.15 + perpendicular.x * bot.botStrafeSeed * 0.95;
  let moveY = aim.y * 0.15 + perpendicular.y * bot.botStrafeSeed * 0.95;
  if (distance < 240) {
    moveX = -aim.x + perpendicular.x * bot.botStrafeSeed * 0.5;
    moveY = -aim.y + perpendicular.y * bot.botStrafeSeed * 0.5;
  } else if (distance > 520) {
    moveX = aim.x * 0.9;
    moveY = aim.y * 0.9;
  }
  if (Math.hypot(bot.x - host.game.hazard.x, bot.y - host.game.hazard.y) < 150) {
    moveX += (bot.x - host.game.hazard.x) / 90;
    moveY += (bot.y - host.game.hazard.y) / 90;
  }
  const move = normalize(moveX, moveY);
  host.inputs[bot.id] = {
    moveX: move.x,
    moveY: move.y,
    aimX: aim.x,
    aimY: aim.y,
    firing: !lineIntersectsObstacle(bot.x, bot.y, target.x, target.y) && distance < 760,
    dashing: (distance < 190 || Math.hypot(bot.x - host.game.hazard.x, bot.y - host.game.hazard.y) < 90) && bot.dashCooldown <= 0
  };
}

function updateAutoAim(player) {
  const target = host.game?.players.find((candidate) => candidate.id !== player.id);
  if (!target) return;
  const aim = normalize(target.x - player.x, target.y - player.y);
  if (aim.x || aim.y) {
    player.aimX = aim.x;
    player.aimY = aim.y;
  }
}

function updatePulsePitPlayer(player, input, delta) {
  const move = normalize(input.moveX, input.moveY);
  updateAutoAim(player);
  if (input.dashing && player.dashCooldown <= 0) {
    player.dashCooldown = DASH_COOLDOWN;
    player.dashTimer = DASH_TIME;
    spawnParticles(player.x, player.y, player.tint, 12, 240);
  }
  const boost = player.speedBoostTimer > 0 ? 1.24 : 1;
  const speed = (player.dashTimer > 0 ? DASH_SPEED : PLAYER_SPEED) * boost;
  movePlayer(player, move.x * speed, move.y * speed, delta);
  player.fireCooldown = Math.max(0, player.fireCooldown - delta);
  player.dashCooldown = Math.max(0, player.dashCooldown - delta);
  player.dashTimer = Math.max(0, player.dashTimer - delta);
  player.shieldTimer = Math.max(0, player.shieldTimer - delta);
  player.rapidTimer = Math.max(0, player.rapidTimer - delta);
  player.flash = Math.max(0, player.flash - delta);
  player.pulse += delta * 3;
  player.trail.push({ x: player.x, y: player.y, life: 0.18, radius: player.radius * 0.78 });
  player.trail = player.trail.map((segment) => ({ ...segment, life: segment.life - delta })).filter((segment) => segment.life > 0);
  if (input.firing && player.fireCooldown <= 0) {
    fireBullet(player);
    player.fireCooldown = player.rapidTimer > 0 ? FIRE_COOLDOWN * 0.6 : FIRE_COOLDOWN;
  }
}

function updateBullets(delta) {
  host.game.bullets = host.game.bullets.filter((bullet) => {
    const nextX = bullet.x + bullet.vx * delta;
    const nextY = bullet.y + bullet.vy * delta;
    bullet.life -= delta;
    if (bullet.life <= 0 || lineIntersectsObstacle(bullet.x, bullet.y, nextX, nextY)) {
      spawnParticles(nextX, nextY, bullet.color, 7, 150);
      return false;
    }
    bullet.x = nextX;
    bullet.y = nextY;
    const target = host.game.players.find((player) => player.id !== bullet.ownerId);
    if (!target) return false;
    if (Math.hypot(bullet.x - target.x, bullet.y - target.y) <= target.radius + bullet.radius) {
      if (target.shieldTimer > 0) {
        spawnParticles(target.x, target.y, "#ffffff", 6, 120);
        playTone(220, 0.05, "triangle", 0.012);
      } else {
        target.hp -= 18;
        target.flash = 0.15;
        host.game.quake = Math.max(host.game.quake, 0.1);
        spawnParticles(target.x, target.y, bullet.color, 10, 180);
        playTone(150, 0.07, "sawtooth", 0.015);
        if (target.hp <= 0) finishPulsePitRound(bullet.ownerId, target);
      }
      return false;
    }
    return true;
  });
}

function updatePulsePitPickups(delta) {
  host.game.pickupTimer -= delta;
  if (host.game.pickupTimer <= 0 && host.game.pickups.length < 2) {
    spawnPickup();
    host.game.pickupTimer = PICKUP_DELAY;
  }
  host.game.pickups = host.game.pickups.filter((pickup) => {
    pickup.pulse += delta * 4;
    const collector = host.game.players.find((player) => Math.hypot(player.x - pickup.x, player.y - pickup.y) < player.radius + pickup.radius);
    if (collector) {
      applyPickup(collector, pickup);
      return false;
    }
    return true;
  });
}

function updateParticles(delta) {
  if (!host.game || host.game.type !== "pulse-pit") return;
  host.game.particles = host.game.particles
    .map((particle) => ({ ...particle, x: particle.x + particle.vx * delta, y: particle.y + particle.vy * delta, life: particle.life - delta }))
    .filter((particle) => particle.life > 0);
  host.game.quake = Math.max(0, host.game.quake - delta * 1.6);
}

function updatePulsePit(now) {
  const delta = Math.min(0.033, (now - host.game.lastTime) / 1000);
  host.game.lastTime = now;
  if (host.game.phase === "playing") {
    const bot = host.game.players.find((player) => player.isBot);
    const human = host.game.players.find((player) => !player.isBot);
    if (bot && human) updateBotInput(bot, human, delta);
    updateHazard(delta);
    updateSpeedRing(delta);
    host.game.players.forEach((player) => updatePulsePitPlayer(player, getShooterInput(player.id), delta));
    updateBullets(delta);
    updatePulsePitPickups(delta);
  }
  updateParticles(delta);
  if (host.game.phase === "round-over" && now >= host.game.countdownUntil) resetPulsePitRound();
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function makeUnoDeck() {
  const deck = [];
  let id = 0;
  for (const color of UNO_COLORS) {
    deck.push({ id: `c${id++}`, color, value: "0", type: "number" });
    for (let n = 1; n <= 9; n += 1) {
      deck.push({ id: `c${id++}`, color, value: String(n), type: "number" });
      deck.push({ id: `c${id++}`, color, value: String(n), type: "number" });
    }
    for (const action of ["skip", "reverse", "draw2"]) {
      deck.push({ id: `c${id++}`, color, value: action, type: action });
      deck.push({ id: `c${id++}`, color, value: action, type: action });
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push({ id: `c${id++}`, color: "wild", value: "wild", type: "wild" });
    deck.push({ id: `c${id++}`, color: "wild", value: "wild4", type: "wild4" });
  }
  return shuffleDeck(deck);
}

function cardPlayable(card, topCard, currentColor) {
  if (!topCard) return true;
  if (card.color === "wild") return true;
  if (card.color === currentColor) return true;
  return card.value === topCard.value;
}

function ensureUnoDeck(uno) {
  if (uno.deck.length) return;
  if (uno.discard.length <= 1) return;
  const top = uno.discard.pop();
  uno.deck = shuffleDeck([...uno.discard]);
  uno.discard = top ? [top] : [];
}

function drawUnoCard(uno, playerId) {
  ensureUnoDeck(uno);
  const card = uno.deck.pop();
  if (card) uno.hands[playerId].push(card);
  return card || null;
}

function chooseBestColor(cards) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const card of cards) {
    if (counts[card.color] !== undefined) counts[card.color] += 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] || "red";
}

function getUnoCurrentPlayer() {
  return host.game.players[host.game.turnIndex] || null;
}

function getUnoTopCard() {
  return host.game.discard[host.game.discard.length - 1] || null;
}

function hasPlayableUnoCard(playerId) {
  const hand = host.game.hands[playerId] || [];
  const topCard = getUnoTopCard();
  return hand.some((card) => cardPlayable(card, topCard, host.game.currentColor));
}

function formatUnoFaceValue(card) {
  if (card.type === "number") return card.value;
  if (card.type === "skip") return "⊘";
  if (card.type === "reverse") return "↺";
  if (card.type === "draw2") return "+2";
  if (card.type === "wild") return "W";
  if (card.type === "wild4") return "+4";
  return card.value.toUpperCase();
}

function createUnoGame() {
  const players = host.state.players.slice(0, 4);
  const deck = makeUnoDeck();
  const hands = {};
  for (const player of players) {
    hands[player.id] = [];
    for (let i = 0; i < 7; i += 1) {
      hands[player.id].push(deck.pop());
    }
  }
  let first = deck.pop();
  while (first && first.type !== "number") {
    deck.unshift(first);
    shuffleDeck(deck);
    first = deck.pop();
  }
  host.game = {
    type: "uno",
    phase: "playing",
    players,
    deck,
    hands,
    discard: first ? [first] : [],
    currentColor: first?.color || "red",
    turnIndex: 0,
    direction: 1,
    winnerId: null,
    drawnCardId: null,
    resultStartedAt: 0,
    log: [`${players[0]?.label || "Player 1"} starts.`]
  };
  host.currentMode = "uno";
  updateUnoControllerViews();
}

function nextUnoIndex(step = 1) {
  const count = host.game.players.length;
  host.game.turnIndex = (host.game.turnIndex + step * host.game.direction + count * 16) % count;
}

function resolveUnoCard(card) {
  const count = host.game.players.length;
  if (card.type === "reverse") {
    if (count === 2) {
      nextUnoIndex(2);
      return;
    }
    host.game.direction *= -1;
    nextUnoIndex(1);
    return;
  }
  if (card.type === "skip") {
    nextUnoIndex(2);
    return;
  }
  if (card.type === "draw2") {
    nextUnoIndex(1);
    const target = getUnoCurrentPlayer();
    if (target) {
      drawUnoCard(host.game, target.id);
      drawUnoCard(host.game, target.id);
    }
    nextUnoIndex(1);
    return;
  }
  if (card.type === "wild4") {
    nextUnoIndex(1);
    const target = getUnoCurrentPlayer();
    if (target) {
      for (let i = 0; i < 4; i += 1) drawUnoCard(host.game, target.id);
    }
    nextUnoIndex(1);
    return;
  }
  nextUnoIndex(1);
}

function buildUnoCardView(card, playable) {
  return {
    id: card.id,
    label: formatUnoFaceValue(card),
    corner: formatUnoFaceValue(card),
    colorCss: UNO_COLOR_CSS[card.color],
    requiresColorChoice: card.type === "wild" || card.type === "wild4",
    playable
  };
}

function updateUnoControllerViews() {
  if (!host.game || host.game.type !== "uno") return;
  if (host.game.phase === "game-over") {
    const winner = host.game.players.find((player) => player.id === host.game.winnerId);
    sendControllerViews({
      default: {
        mode: "uno-result",
        title: `${winner?.label || "A player"} wins`,
        body: "Press PLAY AGAIN for another round, or RETURN TO MENU to head back to the arcade shelf."
      }
    });
    return;
  }
  const currentPlayer = getUnoCurrentPlayer();
  const topCard = getUnoTopCard();
  const viewMap = {};
  for (const player of host.game.players) {
    const hand = host.game.hands[player.id] || [];
    const isCurrent = currentPlayer?.id === player.id;
    const playableInHand = hand.some((card) => cardPlayable(card, topCard, host.game.currentColor));
    const canDraw = isCurrent && !playableInHand && !host.game.drawnCardId;
    const canPass = isCurrent && Boolean(host.game.drawnCardId);
    viewMap[player.id] = {
      mode: "uno",
      turnLabel: isCurrent ? "Your turn" : `${currentPlayer?.label || "Next player"}'s turn`,
      hint: `Top card: ${(host.game.currentColor || topCard?.color || "red").toUpperCase()} ${formatUnoFaceValue(topCard || { type: "wild", value: "wild" })} | Deck: ${host.game.deck.length}`,
      canDraw,
      canPass,
      hand: hand.map((card) => {
        const basePlayable = isCurrent && cardPlayable(card, topCard, host.game.currentColor);
        const playable = host.game.drawnCardId ? card.id === host.game.drawnCardId && basePlayable : basePlayable;
        return buildUnoCardView(card, playable);
      })
    };
  }
  sendControllerViews(viewMap);
}

function finishUnoIfNeeded(currentPlayer, hand) {
  if (hand.length !== 0) return false;
  host.game.winnerId = currentPlayer.id;
  host.game.phase = "game-over";
  host.game.resultStartedAt = performance.now();
  host.game.log.unshift(`${currentPlayer.label} wins the table.`);
  playTone(659, 0.18, "triangle", 0.045);
  setTimeout(() => playTone(880, 0.24, "triangle", 0.04), 80);
  setTimeout(() => playTone(1174, 0.3, "triangle", 0.035), 160);
  updateUnoControllerViews();
  return true;
}

function handleUnoPlay(playerId, cardId, chooseColor = null) {
  if (!host.game || host.game.type !== "uno") return;
  if (host.game.phase !== "playing") return;
  const currentPlayer = getUnoCurrentPlayer();
  if (!currentPlayer || currentPlayer.id !== playerId) return;
  const hand = host.game.hands[playerId];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) return;
  const card = hand[cardIndex];
  const topCard = getUnoTopCard();
  const playable = cardPlayable(card, topCard, host.game.currentColor);
  if (!playable) return;
  if (host.game.drawnCardId && host.game.drawnCardId !== card.id) return;

  hand.splice(cardIndex, 1);
  host.game.discard.push(card);
  host.game.currentColor = card.color === "wild"
    ? (UNO_COLORS.includes(chooseColor) ? chooseColor : chooseBestColor(hand))
    : card.color;
  host.game.drawnCardId = null;
  host.game.log.unshift(`${currentPlayer.label} played ${card.color} ${card.value}.`);
  playTone(card.type === "number" ? 420 : 520, 0.12, "square", 0.02);

  if (finishUnoIfNeeded(currentPlayer, hand)) return;
  resolveUnoCard(card);
  updateUnoControllerViews();
}

function handleUnoDraw(playerId) {
  if (!host.game || host.game.type !== "uno") return;
  if (host.game.phase !== "playing") return;
  const currentPlayer = getUnoCurrentPlayer();
  if (!currentPlayer || currentPlayer.id !== playerId) return;
  if (host.game.drawnCardId) return;
  if (hasPlayableUnoCard(playerId)) return;

  const drawn = drawUnoCard(host.game, playerId);
  host.game.log.unshift(`${currentPlayer.label} drew a card.`);
  playTone(280, 0.09, "sawtooth", 0.018);
  if (!drawn) {
    nextUnoIndex(1);
    updateUnoControllerViews();
    return;
  }

  if (cardPlayable(drawn, getUnoTopCard(), host.game.currentColor)) {
    host.game.drawnCardId = drawn.id;
  } else {
    host.game.drawnCardId = null;
    nextUnoIndex(1);
  }
  updateUnoControllerViews();
}

function handleUnoPass(playerId) {
  if (!host.game || host.game.type !== "uno") return;
  if (host.game.phase !== "playing") return;
  const currentPlayer = getUnoCurrentPlayer();
  if (!currentPlayer || currentPlayer.id !== playerId) return;
  if (!host.game.drawnCardId) return;
  host.game.drawnCardId = null;
  host.game.log.unshift(`${currentPlayer.label} passed.`);
  nextUnoIndex(1);
  updateUnoControllerViews();
}

function handleUnoRematch() {
  if (!host.game || host.game.type !== "uno") return;
  createUnoGame();
  hideOverlay();
}

function processMenuInput(playerId, input) {
  if (host.state.status !== "menu") return;
  let changed = false;
  if (input.menuPrev) {
    host.state.menuIndex = (host.state.menuIndex - 1 + MENU_GAMES.length) % MENU_GAMES.length;
    host.state.selectedGame = MENU_GAMES[host.state.menuIndex].id;
    changed = true;
  }
  if (input.menuNext) {
    host.state.menuIndex = (host.state.menuIndex + 1) % MENU_GAMES.length;
    host.state.selectedGame = MENU_GAMES[host.state.menuIndex].id;
    changed = true;
  }
  if (changed) {
    updateSession({ menuIndex: host.state.menuIndex, selectedGame: host.state.selectedGame });
    const current = getSelectedGame();
    sendArcadeViews(`Selected ${current.title}. Press START to launch.`);
    renderMenu();
  }
  if (input.menuConfirm) {
    const current = getSelectedGame();
    if (host.state.players.length < current.minPlayers) {
      showOverlay("Need More Players", `${current.title} needs at least ${current.minPlayers} players.`);
      return;
    }
    if (current.id === "pulse-pit") {
      createPulsePit();
    } else if (current.id === "uno") {
      createUnoGame();
    }
    updateSession({ status: "playing", selectedGame: current.id });
    setPlayingMode(true);
    hideOverlay();
  }
}

function handleQuitToShelf() {
  host.game = null;
  host.currentMode = "shelf";
  setPlayingMode(false);
  updateSession({ status: "menu" });
  sendArcadeViews("Back at the arcade shelf. Use PREV/NEXT to browse games.");
  showOverlay("Arcade Shelf", "Pick Pulse Pit or UNO, then press START from any phone.");
}

function drawRoundedRect(x, y, w, h, radius, fill) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  if (fill) ctx.fill();
}

function worldScale() {
  return Math.min(host.viewport.width / WORLD.width, host.viewport.height / WORLD.height);
}

function drawPulsePit() {
  if (!host.game || host.game.type !== "pulse-pit") return;
  const scale = worldScale();
  const offsetX = (host.viewport.width - WORLD.width * scale) / 2;
  const offsetY = (host.viewport.height - WORLD.height * scale) / 2;
  const shakeX = (Math.random() - 0.5) * 14 * host.game.quake;
  const shakeY = (Math.random() - 0.5) * 14 * host.game.quake;
  ctx.save();
  ctx.translate(offsetX + shakeX, offsetY + shakeY);
  ctx.scale(scale, scale);

  const bg = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
  bg.addColorStop(0, "#091325");
  bg.addColorStop(1, "#120b1d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  for (let x = 40; x < WORLD.width; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke();
  }
  for (let y = 40; y < WORLD.height; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke();
  }

  ctx.strokeStyle = "rgba(0,255,255,0.3)";
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, WORLD.width - 36, WORLD.height - 36);

  const ringPulse = host.game.speedRing.radius + Math.sin(host.game.speedRing.pulse) * 7;
  ctx.strokeStyle = "rgba(0,255,136,0.5)";
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(host.game.speedRing.x, host.game.speedRing.y, ringPulse, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(0,255,136,0.1)";
  ctx.beginPath(); ctx.arc(host.game.speedRing.x, host.game.speedRing.y, host.game.speedRing.radius, 0, Math.PI * 2); ctx.fill();

  for (const obstacle of host.game.obstacles) {
    const fill = ctx.createLinearGradient(obstacle.x, obstacle.y, obstacle.x + obstacle.w, obstacle.y + obstacle.h);
    fill.addColorStop(0, "rgba(20,33,61,0.95)");
    fill.addColorStop(1, "rgba(12,19,38,0.98)");
    ctx.fillStyle = fill;
    drawRoundedRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h, 18, true);
    ctx.strokeStyle = "rgba(255,0,255,0.2)";
    ctx.lineWidth = 3;
    drawRoundedRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h, 18, false);
  }

  ctx.fillStyle = "rgba(255,200,87,0.2)";
  ctx.beginPath(); ctx.arc(host.game.hazard.x, host.game.hazard.y, host.game.hazard.radius + 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffc857";
  ctx.shadowColor = "#ffc857";
  ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.arc(host.game.hazard.x, host.game.hazard.y, host.game.hazard.radius, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  for (const pickup of host.game.pickups) {
    const color = pickup.type === "heal" ? "#4dde91" : "#ffc857";
    const halo = 20 + Math.sin(pickup.pulse) * 5;
    ctx.fillStyle = `${color}33`;
    ctx.beginPath(); ctx.arc(pickup.x, pickup.y, halo, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(pickup.x, pickup.y, pickup.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#091325";
    ctx.font = '700 16px "Outfit"';
    ctx.textAlign = "center";
    ctx.fillText(pickup.type === "heal" ? "+" : "R", pickup.x, pickup.y + 6);
  }

  for (const bullet of host.game.bullets) {
    ctx.fillStyle = bullet.color;
    ctx.shadowColor = bullet.color;
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  for (const player of host.game.players) {
    for (const segment of player.trail) {
      ctx.fillStyle = `${player.tint}20`;
      ctx.beginPath(); ctx.arc(segment.x, segment.y, segment.radius * (segment.life / 0.18), 0, Math.PI * 2); ctx.fill();
    }
  }

  for (const player of host.game.players) {
    if (player.shieldTimer > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.radius + 12, 0, Math.PI * 2); ctx.stroke();
    }
    if (player.speedBoostTimer > 0) {
      ctx.strokeStyle = "rgba(0,255,136,0.8)";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.radius + 16, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = player.flash > 0 ? "#ffffff" : player.tint;
    ctx.shadowColor = player.tint;
    ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    const aim = normalize(player.aimX, player.aimY);
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(player.x + aim.x * 36, player.y + aim.y * 36); ctx.stroke();
    ctx.fillStyle = "rgba(6,12,24,0.82)";
    ctx.fillRect(player.x - 38, player.y - 44, 76, 8);
    ctx.fillStyle = player.tint;
    ctx.fillRect(player.x - 38, player.y - 44, 76 * Math.max(0, player.hp / 100), 8);
  }

  for (const particle of host.game.particles) {
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = Math.max(0, particle.life / 0.45);
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  const [p1, p2] = host.game.players;
  ctx.fillStyle = "rgba(5,10,22,0.9)";
  drawRoundedRect(22, 20, 250, 64, 22, true);
  drawRoundedRect(host.viewport.width - 272, 20, 250, 64, 22, true);
  drawRoundedRect(host.viewport.width / 2 - 110, 18, 220, 58, 20, true);
  ctx.fillStyle = "#eef4ff";
  ctx.font = '700 26px "Outfit"';
  ctx.textAlign = "left";
  ctx.fillText(`${p1.label}  ${p1.score}`, 40, 58);
  ctx.textAlign = "right";
  ctx.fillText(`${p2.score}  ${p2.label}`, host.viewport.width - 40, 58);
  ctx.textAlign = "center";
  ctx.font = '800 26px "Sora"';
  ctx.fillText("PULSE PIT", host.viewport.width / 2, 55);
  ctx.textAlign = "left";
  ctx.fillStyle = p1.tint;
  ctx.fillRect(40, 66, 150 * (p1.hp / 100), 8);
  ctx.textAlign = "right";
  ctx.fillStyle = p2.tint;
  ctx.fillRect(host.viewport.width - 190, 66, 150 * (p2.hp / 100), 8);
  ctx.textAlign = "center";
  ctx.font = '600 15px "Outfit"';
  ctx.fillStyle = "rgba(238,244,255,0.78)";
  ctx.fillText("Green ring boosts speed. Gold orb punishes greedy paths.", host.viewport.width / 2, host.viewport.height - 22);

  if (host.game.phase === "round-over") {
    const winner = host.game.players.find((player) => player.id === host.game.roundWinnerId);
    ctx.fillStyle = "rgba(5,8,22,0.46)";
    ctx.fillRect(0, 0, host.viewport.width, host.viewport.height);
    ctx.fillStyle = winner.tint;
    ctx.font = '800 46px "Sora"';
    ctx.fillText(`${winner.label} wins the round`, host.viewport.width / 2, host.viewport.height * 0.5);
  }
  if (host.game.phase === "match-over") {
    const winner = host.game.players.find((player) => player.id === host.game.roundWinnerId);
    ctx.fillStyle = "rgba(5,8,22,0.62)";
    ctx.fillRect(0, 0, host.viewport.width, host.viewport.height);
    ctx.fillStyle = winner.tint;
    ctx.font = '800 54px "Sora"';
    ctx.fillText(`${winner.label} wins Pulse Pit`, host.viewport.width / 2, host.viewport.height * 0.46);
    ctx.fillStyle = "#eef4ff";
    ctx.font = '700 22px "Outfit"';
    ctx.fillText("Press QUIT on any phone to return to the arcade shelf.", host.viewport.width / 2, host.viewport.height * 0.54);
  }
  ctx.textAlign = "start";
}

// Updated authentic UNO card drawing
function drawUnoCardFace(x, y, card, facedown = false, currentColor = null) {
  const w = 140;
  const h = 196;
  const color = facedown ? "#1a1a2e" : UNO_COLOR_CSS[currentColor || card.color] || "#2a314a";
  
  ctx.save();
  ctx.shadowColor = "#000000aa";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  
  // Card background
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - w/2, y - h/2, w, h, 16);
  ctx.fill();
  
  // Card border
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "#ffffff33";
  ctx.lineWidth = 3;
  ctx.stroke();
  
  if (!facedown) {
    // White oval
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.2);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#00000033";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 48, 78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#00000022";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    
    // Corner values
    ctx.font = 'bold 28px "Arial Black", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 6;
    ctx.textAlign = "left";
    ctx.fillText(formatUnoFaceValue(card), x - 50, y - 68);
    ctx.textAlign = "right";
    ctx.fillText(formatUnoFaceValue(card), x + 50, y + 78);
    
    // Center value
    ctx.font = 'bold 56px "Arial Black", sans-serif';
    ctx.textAlign = "center";
    ctx.shadowBlur = 10;
    const textColor = (color === UNO_COLOR_CSS.yellow || color === UNO_COLOR_CSS.wild) ? "#1a1a2e" : "#ffffff";
    ctx.fillStyle = textColor;
    ctx.fillText(formatUnoFaceValue(card), x, y + 16);
    
    // For wild cards, add four-color indicator
    if (card.type === "wild" || card.type === "wild4") {
      const colors = ["#ff5f8f", "#ffc857", "#4dde91", "#44d7ff"];
      ctx.shadowBlur = 0;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(x + (i%2===0?-18:18), y + (i<2?-18:18), 10, 0, Math.PI*2);
        ctx.fill();
      }
    }
  } else {
    // Facedown: Z logo
    ctx.font = 'bold 64px "Press Start 2P", cursive';
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 12;
    ctx.textAlign = "center";
    ctx.fillText("Z", x, y+20);
  }
  
  ctx.restore();
}

function drawUnoTable() {
  if (!host.game || host.game.type !== "uno") return;
  const { width, height } = host.viewport;
  const time = performance.now() * 0.001;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0f1d34");
  gradient.addColorStop(1, "#132a22");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.ellipse(width / 2, height / 2, width * 0.33, height * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,0,255,0.3)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(width / 2, height / 2, width * (0.35 + Math.sin(time * 1.7) * 0.01), height * 0.28, 0, 0, Math.PI * 2);
  ctx.stroke();

  const topCard = host.game.discard[host.game.discard.length - 1];
  const centerX = width / 2;
  const centerY = height / 2;

  ctx.fillStyle = "rgba(5,10,22,0.8)";
  drawRoundedRect(centerX - 170, centerY - 120, 120, 170, 20, true);
  drawRoundedRect(centerX + 50, centerY - 120, 120, 170, 20, true);
  drawRoundedRect(width / 2 - 160, 22, 320, 74, 22, true);

  ctx.fillStyle = "#eef4ff";
  ctx.font = '800 28px "Sora"';
  ctx.textAlign = "center";
  ctx.fillText("UNO TABLE", centerX, 58);
  ctx.font = '600 16px "Outfit"';
  const currentPlayer = host.game.players[host.game.turnIndex];
  ctx.fillText(
    host.game.phase === "game-over"
      ? `${host.game.players.find((player) => player.id === host.game.winnerId)?.label || "Winner"} takes the round`
      : `${currentPlayer.label}'s turn • Deck ${host.game.deck.length}`,
    centerX,
    82
  );

  drawUnoCardFace(centerX - 110, centerY - 35, { color: "wild", value: "deck" }, true);
  drawUnoCardFace(centerX + 110, centerY - 35, topCard, false, host.game.currentColor);

  const positions = getUnoSeatPositions(host.game.players.length, width, height);
  host.game.players.forEach((player, index) => {
    const seat = positions[index];
    const active = index === host.game.turnIndex;
    ctx.fillStyle = active ? "rgba(255,0,255,0.2)" : "rgba(255,255,255,0.07)";
    drawRoundedRect(seat.x - 100, seat.y - 36, 200, 72, 18, true);
    ctx.fillStyle = "#eef4ff";
    ctx.font = '700 20px "Outfit"';
    ctx.fillText(player.label, seat.x, seat.y - 6);
    ctx.font = '600 14px "Outfit"';
    ctx.fillText(`${host.game.hands[player.id].length} cards`, seat.x, seat.y + 16);
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(238,244,255,0.84)";
  ctx.font = '600 15px "Outfit"';
  const recent = host.game.log.slice(0, 4);
  recent.forEach((line, index) => {
    ctx.fillText(line, 26, height - 84 + index * 18);
  });

  if (host.game.phase === "game-over") {
    const winner = host.game.players.find((player) => player.id === host.game.winnerId);
    const winnerColor = winner ? (winner.slot === 1 ? "#44d7ff" : winner.slot === 2 ? "#ff5f8f" : winner.slot === 3 ? "#4dde91" : "#ffc857") : "#eef4ff";
    const pulse = 1 + Math.sin(time * 5.2) * 0.06;
    const confettiCount = 24;
    ctx.fillStyle = "rgba(5,8,22,0.62)";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < confettiCount; i += 1) {
      const angle = (Math.PI * 2 * i) / confettiCount + time * 0.8;
      const radius = 150 + (i % 6) * 18 + Math.sin(time * 4 + i) * 8;
      const x = width / 2 + Math.cos(angle) * radius;
      const y = height / 2 + Math.sin(angle) * radius * 0.66;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + time * 1.8);
      ctx.fillStyle = i % 2 === 0 ? winnerColor : "#eef4ff";
      ctx.fillRect(-8, -5, 16, 10);
      ctx.restore();
    }
    ctx.fillStyle = winnerColor;
    ctx.font = '800 56px "Sora"';
    ctx.textAlign = "center";
    ctx.fillText(`${winner?.label || "Winner"} wins UNO`, width / 2, height * 0.43);
    ctx.fillStyle = "#eef4ff";
    ctx.font = '700 22px "Outfit"';
    ctx.fillText("PLAY AGAIN on any phone for a rematch, or QUIT to return to the arcade shelf.", width / 2, height * 0.51);
    ctx.strokeStyle = `${winnerColor}88`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(width / 2, height * 0.44, 146 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function getUnoSeatPositions(count, width, height) {
  const presets = {
    2: [
      { x: width / 2, y: height - 80 },
      { x: width / 2, y: 138 }
    ],
    3: [
      { x: width / 2, y: height - 80 },
      { x: width * 0.24, y: 154 },
      { x: width * 0.76, y: 154 }
    ],
    4: [
      { x: width / 2, y: height - 80 },
      { x: width * 0.2, y: height / 2 },
      { x: width / 2, y: 138 },
      { x: width * 0.8, y: height / 2 }
    ]
  };
  return presets[count] || presets[2];
}

function drawShelf() {
  const gradient = ctx.createLinearGradient(0, 0, host.viewport.width, host.viewport.height);
  gradient.addColorStop(0, "#071120");
  gradient.addColorStop(1, "#120b1d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, host.viewport.width, host.viewport.height);
  
  // Arcade high score display (placeholder)
  //ctx.font = '20px "Press Start 2P"';
  //ctx.fillStyle = "#ff0";
  //ctx.shadowColor = "#ff00ff";
  //ctx.shadowBlur = 10;
  //ctx.textAlign = "right";
  //ctx.fillText("HIGH SCORES", host.viewport.width - 40, 60);
  //ctx.font = '16px "VT323"';
  //ctx.fillStyle = "#0ff";
  //ctx.fillText("1. 2500", host.viewport.width - 40, 100);
  //ctx.fillText("2. 1800", host.viewport.width - 40, 130);
  //ctx.fillText("3. 1200", host.viewport.width - 40, 160);
  //ctx.shadowBlur = 0;
  //ctx.textAlign = "left";
}

function drawGame() {
  ctx.clearRect(0, 0, host.viewport.width, host.viewport.height);
  drawShelf();
  if (!host.game) return;
  if (host.game.type === "pulse-pit") drawPulsePit();
  if (host.game.type === "uno") drawUnoTable();
}

function updateGame(now) {
  if (!host.game) return;
  if (host.game.type === "pulse-pit") updatePulsePit(now);
}

function animate(now) {
  updateGame(now);
  drawGame();
  requestAnimationFrame(animate);
}

function handleControllerAction({ playerId, action }) {
  if (!action) return;
  if (action.type === "quit_to_shelf") {
    handleQuitToShelf();
    return;
  }
  if (!host.game || host.game.type !== "uno") return;
  if (action.type === "uno_draw") handleUnoDraw(playerId);
  if (action.type === "uno_pass") handleUnoPass(playerId);
  if (action.type === "uno_play") handleUnoPlay(playerId, action.cardId, action.chooseColor);
  if (action.type === "uno_rematch") handleUnoRematch();
}

async function boot() {
  resizeCanvas();
  renderPlayers();
  renderMenu();
  sendArcadeViews("Use PREV and NEXT to browse the arcade shelf, then START to launch.");
  showOverlay("Open the room", "Scan the QR on 1-4 phones to join the ZEST arcade. Pulse Pit supports 1-2 players and UNO supports 2-4.");
  requestAnimationFrame(animate);

  const response = await fetch("/api/session", { method: "POST" });
  const data = await response.json();
  host.sessionId = data.sessionId;
  qrImage.src = data.qrDataUrl;
  roomCode.textContent = data.sessionId.toUpperCase();
  joinUrl.href = data.joinUrl;
  joinUrl.textContent = data.joinUrl;
  socket.emit("host:join", { sessionId: data.sessionId });
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointerdown", () => {
  const audio = ensureAudio();
  if (audio && audio.state === "suspended") {
    audio.resume().catch(() => {});
  }
}, { once: true });

socket.on("session:state", (state) => {
  host.state = state;
  renderPlayers();
  renderMenu();

  if (state.status === "waiting") {
    host.game = null;
    host.currentMode = "shelf";
    setPlayingMode(false);
    sendArcadeViews("Scan a phone to enter the arcade.");
    showOverlay("Waiting for players", "Scan at least one phone to unlock the ZEST arcade shelf.");
    return;
  }

  if (state.status === "menu") {
    host.game = null;
    host.currentMode = "shelf";
    setPlayingMode(false);
    sendArcadeViews(`Current game: ${getSelectedGame().title}. Use PREV/NEXT, then START.`);
    showOverlay("Arcade Shelf", `Current selection: ${getSelectedGame().title}. ${state.players.length} player${state.players.length === 1 ? "" : "s"} connected.`);
    return;
  }

  if (state.status === "playing") {
    setPlayingMode(true);
    hideOverlay();
    if (!host.game) {
      if (state.selectedGame === "pulse-pit") createPulsePit();
      if (state.selectedGame === "uno") createUnoGame();
    }
    if (host.game?.type === "pulse-pit") syncPulsePitRoster();
    if (host.game?.type === "uno") updateUnoControllerViews();
  }
});

socket.on("input:update", ({ playerId, input }) => {
  host.inputs[playerId] = input;
  if (host.state.status === "menu") {
    processMenuInput(playerId, input);
  }
  if (host.game?.type === "pulse-pit" && host.game.phase === "match-over" && input.menuQuit) {
    handleQuitToShelf();
  }
});

socket.on("controller:action", handleControllerAction);

socket.on("session:error", ({ message }) => {
  setPlayingMode(false);
  showOverlay("Room error", message);
});

boot().catch((error) => {
  console.error(error);
  setPlayingMode(false);
  showOverlay("Startup failed", "ZEST could not create a live room.");
});






























