const socket = io();
const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session");

const title = document.getElementById("controllerTitle");
const subtitle = document.getElementById("controllerSubtitle");
const movePad = document.getElementById("movePad");
const moveKnob = document.getElementById("moveKnob");
const fireButton = document.getElementById("fireButton");
const dashButton = document.getElementById("dashButton");
const startButton = document.getElementById("startButton");
const quitButton = document.getElementById("quitButton");
const prevButton = document.getElementById("prevButton");
const nextButton = document.getElementById("nextButton");
const shooterControls = document.getElementById("shooterControls");
const unoPanel = document.getElementById("unoPanel");
const unoResultPanel = document.getElementById("unoResultPanel");
const unoHand = document.getElementById("unoHand");
const unoTurnLabel = document.getElementById("unoTurnLabel");
const unoHint = document.getElementById("unoHint");
const unoDrawButton = document.getElementById("unoDrawButton");
const unoPassButton = document.getElementById("unoPassButton");
const unoResultTitle = document.getElementById("unoResultTitle");
const unoResultBody = document.getElementById("unoResultBody");
const unoPlayAgainButton = document.getElementById("unoPlayAgainButton");
const unoMenuButton = document.getElementById("unoMenuButton");
const arcadeNote = document.getElementById("arcadeNote");
const wildColorPicker = document.getElementById("wildColorPicker");
const wildColorButtons = Array.from(document.querySelectorAll(".mobile-ctrl__wild-button"));

const inputState = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  firing: false,
  dashing: false,
  menuConfirm: false,
  menuPrev: false,
  menuNext: false,
  menuQuit: false
};

let currentView = { mode: "arcade" };
let pendingWildCardId = null;

function sendState() {
  if (!sessionId) return;
  socket.emit("controller:input", { sessionId, input: inputState });
  inputState.menuConfirm = false;
  inputState.dashing = false;
  inputState.menuPrev = false;
  inputState.menuNext = false;
  inputState.menuQuit = false;
}

function sendAction(action) {
  if (!sessionId) return;
  socket.emit("controller:action", { sessionId, action });
}

function updateKnobPosition(knob, x, y, radius) {
  knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
}

function bindStick(pad, knob, onChange) {
  let pointerId = null;
  let radius = 36;

  function recalcRadius() {
    radius = Math.max(20, pad.clientWidth * 0.22);
  }

  function handleMove(event) {
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(distance, radius);
    const x = Number((((dx / distance) * clamped) / radius).toFixed(3));
    const y = Number((((dy / distance) * clamped) / radius).toFixed(3));
    updateKnobPosition(knob, x, y, radius);
    onChange(x, y);
    sendState();
  }

  function release(event) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    pad.classList.remove("active");
    updateKnobPosition(knob, 0, 0, radius);
    onChange(0, 0);
    sendState();
  }

  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    recalcRadius();
    pointerId = event.pointerId;
    pad.setPointerCapture(pointerId);
    pad.classList.add("active");
    handleMove(event);
  });

  pad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    handleMove(event);
  });

  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  window.addEventListener("resize", recalcRadius);
  recalcRadius();
}

bindStick(movePad, moveKnob, (x, y) => {
  inputState.moveX = x;
  inputState.moveY = y;
});

function bindHoldButton(button, key) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.classList.add("pressed");
    inputState[key] = true;
    sendState();
  });

  function release(event) {
    event.preventDefault();
    button.classList.remove("pressed");
    inputState[key] = false;
    sendState();
  }

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
}

function bindTapButton(button, updater) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.classList.add("pressed");
    updater();
    sendState();
    window.setTimeout(() => button.classList.remove("pressed"), 120);
  });
}

bindHoldButton(fireButton, "firing");

bindTapButton(dashButton, () => {
  inputState.dashing = true;
});

bindTapButton(startButton, () => {
  inputState.menuConfirm = true;
});

bindTapButton(prevButton, () => {
  inputState.menuPrev = true;
});

bindTapButton(nextButton, () => {
  inputState.menuNext = true;
});

quitButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  quitButton.classList.add("pressed");
  inputState.menuQuit = true;
  sendState();
  sendAction({ type: "quit_to_shelf" });
  window.setTimeout(() => quitButton.classList.remove("pressed"), 120);
});

unoDrawButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  unoDrawButton.classList.add("pressed");
  sendAction({ type: "uno_draw" });
  window.setTimeout(() => unoDrawButton.classList.remove("pressed"), 120);
});

unoPassButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  unoPassButton.classList.add("pressed");
  sendAction({ type: "uno_pass" });
  window.setTimeout(() => unoPassButton.classList.remove("pressed"), 120);
});

unoPlayAgainButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  unoPlayAgainButton.classList.add("pressed");
  sendAction({ type: "uno_rematch" });
  window.setTimeout(() => unoPlayAgainButton.classList.remove("pressed"), 120);
});

unoMenuButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  unoMenuButton.classList.add("pressed");
  sendAction({ type: "quit_to_shelf" });
  window.setTimeout(() => unoMenuButton.classList.remove("pressed"), 120);
});

function closeWildPicker() {
  pendingWildCardId = null;
  wildColorPicker.classList.add("hidden");
}

wildColorButtons.forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (!pendingWildCardId) return;
    sendAction({
      type: "uno_play",
      cardId: pendingWildCardId,
      chooseColor: button.dataset.color
    });
    closeWildPicker();
  });
});

wildColorPicker.addEventListener("pointerdown", (event) => {
  if (event.target === wildColorPicker) {
    closeWildPicker();
  }
});

function renderUnoHand(view) {
  unoHand.innerHTML = "";
  unoTurnLabel.textContent = view.turnLabel || "UNO";
  unoHint.textContent = view.hint || "Choose a playable card or draw.";
  unoDrawButton.disabled = !view.canDraw;
  unoPassButton.classList.toggle("hidden", !view.canPass);

  for (const card of view.hand || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mobile-ctrl__uno-card ${card.playable ? "is-playable" : "is-locked"}`;
    button.disabled = !card.playable;
    button.innerHTML = `
      <span class="mobile-ctrl__uno-corner mobile-ctrl__uno-corner--tl">${card.corner}</span>
      <span class="mobile-ctrl__uno-oval"><span class="mobile-ctrl__uno-label">${card.label}</span></span>
      <span class="mobile-ctrl__uno-corner mobile-ctrl__uno-corner--br">${card.corner}</span>
    `;
    button.style.setProperty("--uno-card-color", card.colorCss);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!card.playable) return;
      if (card.requiresColorChoice) {
        pendingWildCardId = card.id;
        wildColorPicker.classList.remove("hidden");
        return;
      }
      sendAction({ type: "uno_play", cardId: card.id });
    });
    unoHand.appendChild(button);
  }
}

function renderUnoResult(view) {
  unoResultTitle.textContent = view.title || "Winner";
  unoResultBody.textContent = view.body || "Choose what happens next.";
}

function applyView(view) {
  currentView = view || { mode: "arcade" };
  const mode = currentView.mode || "arcade";
  const isArcade = mode === "arcade";
  const isUno = mode === "uno";
  const isUnoResult = mode === "uno-result";

  shooterControls.classList.toggle("hidden", !isArcade);
  unoPanel.classList.toggle("hidden", !isUno);
  unoResultPanel.classList.toggle("hidden", !isUnoResult);
  startButton.classList.toggle("hidden", !isArcade);
  prevButton.classList.toggle("hidden", !isArcade);
  nextButton.classList.toggle("hidden", !isArcade);
  dashButton.classList.toggle("hidden", !isArcade);
  fireButton.classList.toggle("hidden", !isArcade);

  arcadeNote.textContent = currentView.arcadeHint || "Auto-aim tracks the rival. Browse the shelf with PREV and NEXT, then press START.";

  if (isUno) {
    renderUnoHand(currentView);
  } else {
    unoHand.innerHTML = "";
  }

  if (isUnoResult) {
    renderUnoResult(currentView);
  }

  if (!isUno) {
    closeWildPicker();
  }
}

if (!sessionId) {
  title.textContent = "Missing room";
  subtitle.textContent = "Open this page using a valid ZEST room QR code.";
} else {
  socket.emit("controller:join", { sessionId, nickname: "" });
}

socket.on("controller:accepted", ({ slot }) => {
  title.textContent = `Player ${slot} synced`;
  subtitle.textContent = "Your phone is ready. The page scrolls normally, and the control areas stay inside the screen.";
});

socket.on("session:state", ({ status, selectedGame, players }) => {
  if (status === "waiting") {
    subtitle.textContent = "Waiting for the next player to join the room.";
    return;
  }

  if (status === "menu") {
    subtitle.textContent = `Arcade shelf open. Current game: ${selectedGame === "uno" ? "UNO" : "Pulse Pit"}. ${players.length === 1 ? "Solo mode is available." : "Press START when ready."}`;
    return;
  }

  if (status === "playing") {
    subtitle.textContent = currentView.mode === "uno"
      ? "UNO is live. Play a card, draw when needed, or quit back to the shelf."
      : currentView.mode === "uno-result"
      ? "UNO round over. Play again or return to the menu."
      : "Pulse Pit is live. Move, fire, burst, or quit whenever you want.";
  }
});

socket.on("controller:view", (view) => {
  applyView(view);
});

socket.on("session:error", ({ message }) => {
  title.textContent = "Room issue";
  subtitle.textContent = message;
});
