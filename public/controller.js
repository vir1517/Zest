const socket = io();
const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session");

// ── DOM refs ──
const title          = document.getElementById("controllerTitle");
const subtitle       = document.getElementById("controllerSubtitle");
const movePad        = document.getElementById("movePad");
const moveKnob       = document.getElementById("moveKnob");
const fireButton     = document.getElementById("fireButton");
const dashButton     = document.getElementById("dashButton");
const quitButton     = document.getElementById("quitButton");
const navControls    = document.getElementById("navControls");
const shooterControls= document.getElementById("shooterControls");
const unoPanel       = document.getElementById("unoPanel");
const unoResultPanel = document.getElementById("unoResultPanel");
const unoHand        = document.getElementById("unoHand");
const unoTurnLabel   = document.getElementById("unoTurnLabel");
const unoHint        = document.getElementById("unoHint");
const unoDrawButton  = document.getElementById("unoDrawButton");
const unoPassButton  = document.getElementById("unoPassButton");
const unoResultTitle = document.getElementById("unoResultTitle");
const unoResultBody  = document.getElementById("unoResultBody");
const unoPlayAgainButton = document.getElementById("unoPlayAgainButton");
const unoMenuButton  = document.getElementById("unoMenuButton");
const arcadeNote     = document.getElementById("arcadeNote");
const wildColorPicker= document.getElementById("wildColorPicker");
const wildColorButtons = Array.from(document.querySelectorAll(".mobile-ctrl__wild-button"));
const navUp          = document.getElementById("navUp");
const navDown        = document.getElementById("navDown");
const navLeft        = document.getElementById("navLeft");
const navRight       = document.getElementById("navRight");
const navSelect      = document.getElementById("navSelect");

// ── State ──
const inputState = {
  moveX: 0, moveY: 0, aimX: 0, aimY: 0,
  firing: false, dashing: false,
  menuConfirm: false, menuPrev: false, menuNext: false, menuQuit: false
};
let currentView = { mode: "nav" };
let pendingWildCardId = null;

// ── Panels ──
const ALL_PANELS = [navControls, shooterControls, unoPanel, unoResultPanel];

function showOnly(panel) {
  ALL_PANELS.forEach(p => p && p.classList.add("hidden"));
  if (panel) panel.classList.remove("hidden");
}

// ── Send ──
function sendState() {
  if (!sessionId) return;
  socket.emit("controller:input", { sessionId, input: inputState });
  inputState.menuConfirm = false;
  inputState.dashing     = false;
  inputState.menuPrev    = false;
  inputState.menuNext    = false;
  inputState.menuQuit    = false;
}

function sendAction(action) {
  if (!sessionId) return;
  socket.emit("controller:action", { sessionId, action });
}

// ── Joystick ──
function bindStick(pad, knob, onChange) {
  let pointerId = null;
  let radius = 36;

  function recalc() { radius = Math.max(20, pad.clientWidth * 0.22); }

  function handleMove(e) {
    const rect = pad.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top  + rect.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, radius);
    const x = Number(((dx / dist * clamped) / radius).toFixed(3));
    const y = Number(((dy / dist * clamped) / radius).toFixed(3));
    knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    onChange(x, y);
    sendState();
  }

  function release(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    pad.classList.remove("active");
    knob.style.transform = "translate(0,0)";
    onChange(0, 0);
    sendState();
  }

  pad.addEventListener("pointerdown", e => {
    e.preventDefault(); recalc();
    pointerId = e.pointerId;
    pad.setPointerCapture(pointerId);
    pad.classList.add("active");
    handleMove(e);
  });
  pad.addEventListener("pointermove", e => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault(); handleMove(e);
  });
  pad.addEventListener("pointerup",     release);
  pad.addEventListener("pointercancel", release);
  window.addEventListener("resize", recalc);
  recalc();
}

if (movePad && moveKnob) {
  bindStick(movePad, moveKnob, (x, y) => { inputState.moveX = x; inputState.moveY = y; });
}

// ── Button helpers ──
function bindHold(btn, key) {
  if (!btn) return;
  btn.addEventListener("pointerdown", e => {
    e.preventDefault(); btn.classList.add("pressed");
    inputState[key] = true; sendState();
  });
  const up = e => { e.preventDefault(); btn.classList.remove("pressed"); inputState[key] = false; sendState(); };
  btn.addEventListener("pointerup",     up);
  btn.addEventListener("pointercancel", up);
}

function bindTap(btn, fn) {
  if (!btn) return;
  btn.addEventListener("pointerdown", e => {
    e.preventDefault(); btn.classList.add("pressed");
    fn(); sendState();
    setTimeout(() => btn.classList.remove("pressed"), 120);
  });
}

bindHold(fireButton, "firing");
bindTap(dashButton,  () => { inputState.dashing     = true; });

quitButton?.addEventListener("pointerdown", e => {
  e.preventDefault();
  quitButton.classList.add("pressed");
  inputState.menuQuit = true;
  sendState();
  sendAction({ type: "quit_to_shelf" });
  setTimeout(() => quitButton.classList.remove("pressed"), 120);
});

// ── D-pad (nav mode) ──
navUp?.addEventListener("pointerdown", e => {
  e.preventDefault(); navUp.classList.add("pressed");
  inputState.moveY = -1; sendState();
});
navUp?.addEventListener("pointerup", () => {
  navUp.classList.remove("pressed");
  inputState.moveY = 0; sendState();
});
navDown?.addEventListener("pointerdown", e => {
  e.preventDefault(); navDown.classList.add("pressed");
  inputState.moveY = 1; sendState();
});
navDown?.addEventListener("pointerup", () => {
  navDown.classList.remove("pressed");
  inputState.moveY = 0; sendState();
});

// Left/Right as menuPrev/menuNext
navLeft?.addEventListener("pointerdown", e => {
  e.preventDefault(); navLeft.classList.add("pressed");
  inputState.menuPrev = true; sendState();
  setTimeout(() => navLeft.classList.remove("pressed"), 120);
});
navRight?.addEventListener("pointerdown", e => {
  e.preventDefault(); navRight.classList.add("pressed");
  inputState.menuNext = true; sendState();
  setTimeout(() => navRight.classList.remove("pressed"), 120);
});

// A button as menuConfirm
navSelect?.addEventListener("pointerdown", e => {
  e.preventDefault(); navSelect.classList.add("pressed");
  inputState.menuConfirm = true; sendState();
  setTimeout(() => navSelect.classList.remove("pressed"), 120);
});

// ── UNO actions ──
unoDrawButton?.addEventListener("pointerdown", e => { e.preventDefault(); sendAction({ type: "uno_draw" }); });
unoPassButton?.addEventListener("pointerdown", e => { e.preventDefault(); sendAction({ type: "uno_pass" }); });
unoPlayAgainButton?.addEventListener("pointerdown", e => { e.preventDefault(); sendAction({ type: "uno_rematch" }); });
unoMenuButton?.addEventListener("pointerdown", e => { e.preventDefault(); sendAction({ type: "quit_to_shelf" }); });

// ── Wild color picker ──
function closeWildPicker() { pendingWildCardId = null; wildColorPicker.classList.add("hidden"); }

wildColorButtons.forEach(btn => {
  btn.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (!pendingWildCardId) return;
    sendAction({ type: "uno_play", cardId: pendingWildCardId, chooseColor: btn.dataset.color });
    closeWildPicker();
  });
});
wildColorPicker?.addEventListener("pointerdown", e => { if (e.target === wildColorPicker) closeWildPicker(); });

// ── Render UNO hand ──
function renderUnoHand(view) {
  unoHand.innerHTML = "";
  unoTurnLabel.textContent = view.turnLabel || "UNO";
  unoHint.textContent      = view.hint      || "Play a card or draw.";
  unoDrawButton.disabled   = !view.canDraw;
  unoPassButton.classList.toggle("hidden", !view.canPass);

  for (const card of (view.hand || [])) {
    const btn = document.createElement("button");
    btn.className = `mobile-ctrl__uno-card ${card.playable ? "is-playable" : "is-locked"}`;
    btn.disabled  = !card.playable;
    btn.style.setProperty("--uno-card-color", card.colorCss);
    btn.innerHTML = `
      <span class="mobile-ctrl__uno-corner mobile-ctrl__uno-corner--tl">${card.corner}</span>
      <span class="mobile-ctrl__uno-oval"><span class="mobile-ctrl__uno-label">${card.label}</span></span>
      <span class="mobile-ctrl__uno-corner mobile-ctrl__uno-corner--br">${card.corner}</span>
    `;
    btn.addEventListener("pointerdown", e => {
      e.preventDefault();
      if (!card.playable) return;
      if (card.requiresColorChoice) { pendingWildCardId = card.id; wildColorPicker.classList.remove("hidden"); return; }
      sendAction({ type: "uno_play", cardId: card.id });
    });
    unoHand.appendChild(btn);
  }
}

function renderUnoResult(view) {
  unoResultTitle.textContent = view.title || "Winner";
  unoResultBody.textContent  = view.body  || "Choose what happens next.";
}

// ── Apply view from host ──
function applyView(view) {
  currentView = view || { mode: "nav" };
  const mode = currentView.mode;

  if (mode === "nav" || mode === "arcade" && !shooterControls) {
    showOnly(navControls);
  } else if (mode === "arcade") {
    showOnly(shooterControls);
    arcadeNote.textContent = currentView.arcadeHint || "Auto-aim on. Move with joystick.";
  } else if (mode === "uno") {
    showOnly(unoPanel);
    renderUnoHand(currentView);
  } else if (mode === "uno-result") {
    showOnly(unoResultPanel);
    renderUnoResult(currentView);
  } else {
    showOnly(navControls);
  }

  if (mode !== "uno") closeWildPicker();
}

// ── Init ──
if (!sessionId) {
  title.textContent    = "No room";
  subtitle.textContent = "Scan a ZEST QR code to join.";
} else {
  socket.emit("controller:join", { sessionId, nickname: "" });
}
applyView({ mode: "nav" });

// ── Socket events ──
socket.on("controller:accepted", ({ slot }) => {
  title.textContent    = `Player ${slot}`;
  subtitle.textContent = "Use the D-pad to browse. A to launch a game.";
});

socket.on("session:state", ({ status, selectedGame }) => {
  if (currentView.mode === "arcade" || currentView.mode === "uno" || currentView.mode === "uno-result") return;
  if (status === "waiting") subtitle.textContent = "Waiting for more players...";
  else if (status === "menu") subtitle.textContent = `Shelf open — ${selectedGame === "uno" ? "UNO" : "Pulse Pit"} selected.`;
  else if (status === "playing") subtitle.textContent = "Game in progress.";
});

socket.on("controller:view", applyView);
socket.on("session:error", ({ message }) => {
  title.textContent    = "Room error";
  subtitle.textContent = message;
});