/**
 * WatchParty Sync Agent — content-cinevo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Injected into cinevo.nl by the MV3 extension. Implements Option C: each
 * viewer's real browser plays the movie (native Cloudflare clearance), and
 * this agent keeps everyone on the same frame via our Socket.IO sync-service.
 *
 * Architecture (per research tracks r2 + r3):
 *  - Isolated-world content script → CAN open WebSocket directly (Chrome docs:
 *    isolated-world scripts have their own CSP, independent of the page's CSP).
 *    So cinevo.nl's strict CSP does NOT block our WS connection.
 *  - Cristian's-algorithm clock sync (8-sample NTP-style low-RTT filter).
 *  - Server-authoritative playback state with monotonic seq.
 *  - 3-band drift correction: ±125ms soft / ±750ms rate-nudge / ±1500ms hard seek.
 *  - Guard-flag + debounce pattern prevents feedback loops on programmatic seeks.
 *  - MutationObserver re-discovers the <video> element on SPA navigation / ad breaks.
 *  - Ad detection: short-duration or small video = ad → don't broadcast, don't correct.
 *  - Page-context scriptlet (injected.js) for wrapped players that ignore direct
 *    currentTime writes (like Netflix does).
 *
 * Room context (roomId, userId, userName, syncUrl, cinevoUrl) arrives via
 * chrome.storage.session, written by content-bridge.js on the WatchParty app.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DRIFT_SOFT_MS = 125;      // ITU-R BT.1359 perceptibility threshold — ignore
const DRIFT_RATE_MS = 750;      // rate-nudge zone (0.96-1.04x)
const DRIFT_HARD_MS = 1500;     // hard seek zone
const RATE_MIN = 0.96;
const RATE_MAX = 1.04;
const SEEK_DEBOUNCE_MS = 300;   // debounce user seeks before broadcasting
const APPLY_WINDOW_MS = 1500;   // guard-flag window after applying server state
const CLOCK_SYNC_INTERVAL_MS = 5000;
const DRIFT_CHECK_INTERVAL_MS = 2000;
const AD_DURATION_THRESHOLD_S = 60; // videos shorter than this are likely ads
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

let roomCtx = null;        // { roomId, userId, userName, syncUrl, cinevoUrl, color }
let socket = null;         // Socket.IO socket
let videoEl = null;        // current main <video> element
let observer = null;       // MutationObserver for video re-discovery
let stats = { connected: false, clockOffset: 0, rtt: 0, drift: 0, participants: 0 };
let playback = null;       // last authoritative PlaybackState from server
let lastSeq = -1;          // last applied seq (dedup out-of-order packets)
let guardUntil = 0;        // timestamp until which local events are ignored
let seekDebounce = null;   // setTimeout handle for seek debouncing
let clockSamples = [];     // [{t0, t1, serverTime}] for Cristian's filter
let clockInterval = null;
let driftInterval = null;
let reconnectDelay = RECONNECT_BASE_MS;
let agentState = "DISCONNECTED"; // DISCONNECTED | CONNECTING | WAITING_FOR_VIDEO | SYNCING | RECOVERY
let adState = { inAd: false, adVideoEl: null };

// ═══════════════════════════════════════════════════════════════════════════
// Socket.IO loader (from CDN — same pattern as use-sync-engine.ts)
// ═══════════════════════════════════════════════════════════════════════════

let ioPromise = null;
function getIo() {
  if (window.io) return Promise.resolve(window.io);
  if (!ioPromise) {
    ioPromise = fetch("https://cdn.socket.io/4.8.3/socket.io.min.js")
      .then((r) => r.text())
      .then((code) => {
        new Function(code)();
        if (!window.io) throw new Error("socket.io failed to init");
        return window.io;
      });
  }
  return ioPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// Overlay UI — floating sync indicator + chat
// ═══════════════════════════════════════════════════════════════════════════

function ensureOverlay() {
  if (document.getElementById("wp-overlay")) return;
  const root = document.createElement("div");
  root.id = "wp-overlay";
  root.innerHTML = `
    <div id="wp-pill" class="wp-pill">
      <span class="wp-dot" id="wp-dot"></span>
      <span id="wp-status">Connecting…</span>
      <span id="wp-drift" class="wp-drift"></span>
      <button id="wp-chat-toggle" class="wp-chat-btn" title="Chat">💬</button>
    </div>
    <div id="wp-chat" class="wp-chat wp-hidden">
      <div id="wp-chat-msgs" class="wp-chat-msgs"></div>
      <form id="wp-chat-form" class="wp-chat-form">
        <input id="wp-chat-input" placeholder="Message…" maxlength="1000" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `;
  document.documentElement.appendChild(root);

  const toggle = document.getElementById("wp-chat-toggle");
  const chat = document.getElementById("wp-chat");
  toggle.addEventListener("click", () => chat.classList.toggle("wp-hidden"));
  document.getElementById("wp-chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("wp-chat-input");
    const text = input.value.trim();
    if (!text || !socket) return;
    socket.emit("chat:send", { text });
    input.value = "";
  });
}

function updateOverlay() {
  ensureOverlay();
  const dot = document.getElementById("wp-dot");
  const status = document.getElementById("wp-status");
  const drift = document.getElementById("wp-drift");
  const stateLabel = {
    DISCONNECTED: "Offline",
    CONNECTING: "Connecting…",
    WAITING_FOR_VIDEO: "Waiting for video…",
    SYNCING: "Synced",
    RECOVERY: "Reconnecting…",
  }[agentState] || agentState;
  status.textContent = `${stateLabel} · ${stats.participants} 👥`;
  drift.textContent = stats.connected ? `${Math.round(stats.drift)}ms` : "";
  dot.className = "wp-dot " + (stats.connected ? "wp-dot-on" : "wp-dot-off");
  if (agentState === "SYNCING") dot.className += " wp-dot-sync";
}

function addChatMessage(m) {
  ensureOverlay();
  const msgs = document.getElementById("wp-chat-msgs");
  const el = document.createElement("div");
  el.className = "wp-chat-msg" + (m.userId === "system" ? " wp-chat-sys" : "");
  if (m.userId === "system") {
    el.textContent = m.text;
  } else {
    el.innerHTML = `<span class="wp-chat-name" style="color:${m.color}">${escapeHtml(m.userName)}:</span> ${escapeHtml(m.text)}`;
  }
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  // Keep last 100
  while (msgs.children.length > 100) msgs.removeChild(msgs.firstChild);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ═══════════════════════════════════════════════════════════════════════════
// Video element discovery + control
// ═══════════════════════════════════════════════════════════════════════════

function findMainVideo() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];
  // Multi-video: pick the largest area × longest duration (main content, not ad)
  return videos
    .map((v) => {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      const dur = v.duration && isFinite(v.duration) ? v.duration : 0;
      return { v, area, dur, score: area * (dur > AD_DURATION_THRESHOLD_S ? 2 : 0.5) };
    })
    .sort((a, b) => b.score - a.score)[0].v;
}

function isAdVideo(v) {
  if (!v) return false;
  if (v.duration && isFinite(v.duration) && v.duration < AD_DURATION_THRESHOLD_S) return true;
  // Heuristic: ad videos are often small / off-corner
  const r = v.getBoundingClientRect();
  if (r.width < 320 || r.height < 180) return true;
  return false;
}

function attachVideo(v) {
  if (videoEl === v) return;
  detachVideo();
  videoEl = v;

  videoEl.addEventListener("play", onPlay);
  videoEl.addEventListener("pause", onPause);
  videoEl.addEventListener("seeking", onSeeking);
  videoEl.addEventListener("seeked", onSeeked);
  videoEl.addEventListener("ratechange", onRateChange);
  videoEl.addEventListener("waiting", onWaiting);
  videoEl.addEventListener("playing", onPlaying);
  videoEl.addEventListener("loadedmetadata", onLoadedMetadata);

  agentState = "SYNCING";
  updateOverlay();

  // Immediately apply current authoritative state if we have it
  if (playback && playback.videoUrl) {
    applyState(playback);
  }
}

function detachVideo() {
  if (!videoEl) return;
  videoEl.removeEventListener("play", onPlay);
  videoEl.removeEventListener("pause", onPause);
  videoEl.removeEventListener("seeking", onSeeking);
  videoEl.removeEventListener("seeked", onSeeked);
  videoEl.removeEventListener("ratechange", onRateChange);
  videoEl.removeEventListener("waiting", onWaiting);
  videoEl.removeEventListener("playing", onPlaying);
  videoEl.removeEventListener("loadedmetadata", onLoadedMetadata);
  videoEl = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Video event handlers — broadcast local state to server (with guard flags)
// ═══════════════════════════════════════════════════════════════════════════

function onPlay() {
  if (Date.now() < guardUntil) return;
  if (adState.inAd) return;
  flushIntent({ isPlaying: true });
}
function onPause() {
  if (Date.now() < guardUntil) return;
  if (adState.inAd) return;
  if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }
  flushIntent({ isPlaying: false });
}
function onSeeking() {
  if (Date.now() < guardUntil) return;
  if (adState.inAd) return;
  // Debounce — seeking fires multiple events
  if (seekDebounce) clearTimeout(seekDebounce);
  seekDebounce = setTimeout(flushIntent, SEEK_DEBOUNCE_MS);
}
function onSeeked() {
  // handled by the debounce from onSeeking
}
function onRateChange() {
  // DON'T broadcast ratechange — it's often a local drift-correction nudge.
  // Rate is only broadcast on explicit user action (rare). Per r3 pitfall #3.
}
function onWaiting() {
  // Buffering — don't broadcast (let drift correction handle on resume)
}
function onPlaying() {
  // Resumed from buffering — if we drifted, the drift check will catch it
}
function onLoadedMetadata() {
  // Late-joiner catch-up: as soon as we know the duration, seek to expected position
  if (playback && playback.videoUrl) {
    applyState(playback);
  }
}

function flushIntent(patch) {
  if (!socket || !videoEl) return;
  if (videoEl.currentTime != null) {
    patch.currentTime = videoEl.currentTime;
  }
  socket.emit("state:intent", patch);
}

// ═══════════════════════════════════════════════════════════════════════════
// Apply authoritative state from server — with 3-band drift correction
// ═══════════════════════════════════════════════════════════════════════════

function applyState(p) {
  if (!videoEl) return;
  if (p.seq != null && p.seq === lastSeq) return;
  if (p.seq != null) lastSeq = p.seq;

  // Don't correct during ads
  if (adState.inAd) return;

  const serverNow = Date.now() + stats.clockOffset;
  const elapsed = p.isPlaying ? (serverNow - p.lastChangedAt) / 1000 : 0;
  const expected = p.currentTime + elapsed * (p.playbackRate || 1);
  const actual = videoEl.currentTime || 0;
  const driftMs = Math.abs(actual - expected) * 1000;

  guardUntil = Date.now() + APPLY_WINDOW_MS;

  try {
    if (driftMs < DRIFT_SOFT_MS) {
      // Soft band — no correction needed
    } else if (driftMs < DRIFT_RATE_MS) {
      // Rate-nudge band — speed up or slow down slightly to catch up
      const sign = expected > actual ? 1 : -1;
      const rate = sign > 0 ? RATE_MAX : RATE_MIN;
      if (Math.abs(videoEl.playbackRate - rate) > 0.01) {
        videoEl.playbackRate = rate;
        videoEl.preservesPitch = true;
        try { videoEl.webkitPreservesPitch = true; } catch {}
      }
      // After catching up, rate will be reset by the drift check
    } else {
      // Hard seek band — just seek
      videoEl.currentTime = expected;
    }

    // Sync play/pause state
    if (p.isPlaying && videoEl.paused) {
      videoEl.play().catch(() => {});
    } else if (!p.isPlaying && !videoEl.paused) {
      videoEl.pause();
    }

    // Reset playback rate if we're in the soft band and it was nudged
    if (driftMs < DRIFT_SOFT_MS && videoEl.playbackRate !== (p.playbackRate || 1)) {
      videoEl.playbackRate = p.playbackRate || 1;
    }
  } catch (e) {
    // Some players throw on currentTime writes (wrapped) — try the page-context scriptlet
    injectPageScriptlet("applyState", { currentTime: expected, isPlaying: p.isPlaying, rate: p.playbackRate || 1 });
  }
}

// Periodic drift check — catches drift that develops between state updates
function checkDrift() {
  if (!videoEl || !playback || !playback.isPlaying || adState.inAd) return;
  if (Date.now() < guardUntil) return;
  try {
    const serverNow = Date.now() + stats.clockOffset;
    const elapsed = (serverNow - playback.lastChangedAt) / 1000;
    const expected = playback.currentTime + elapsed * (playback.playbackRate || 1);
    const actual = videoEl.currentTime || 0;
    const driftMs = Math.abs(actual - expected) * 1000;
    stats.drift = driftMs;
    updateOverlay();

    if (driftMs > DRIFT_HARD_MS) {
      guardUntil = Date.now() + APPLY_WINDOW_MS;
      try { videoEl.currentTime = expected; } catch {}
    } else if (driftMs > DRIFT_RATE_MS) {
      const sign = expected > actual ? 1 : -1;
      const rate = sign > 0 ? RATE_MAX : RATE_MIN;
      if (Math.abs(videoEl.playbackRate - rate) > 0.01) {
        videoEl.playbackRate = rate;
        videoEl.preservesPitch = true;
      }
    } else if (driftMs < DRIFT_SOFT_MS && videoEl.playbackRate !== (playback.playbackRate || 1)) {
      // Back to normal rate once caught up
      videoEl.playbackRate = playback.playbackRate || 1;
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// Ad detection
// ═══════════════════════════════════════════════════════════════════════════

function checkForAds() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length <= 1) {
    if (adState.inAd) {
      adState.inAd = false;
      adState.adVideoEl = null;
      // Re-attach main video and hard-seek to expected position
      const main = findMainVideo();
      if (main) attachVideo(main);
      if (playback && videoEl) applyState(playback);
    }
    return;
  }
  // Multiple videos — find the ad (short/small one)
  const ads = videos.filter(isAdVideo);
  if (ads.length > 0 && !adState.inAd) {
    adState.inAd = true;
    adState.adVideoEl = ads[0];
    if (socket) socket.emit("agent:ad", { inAd: true });
    // Make sure we're attached to the MAIN video, not the ad
    const main = videos.find((v) => !isAdVideo(v));
    if (main && videoEl !== main) attachVideo(main);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Page-context scriptlet — for wrapped players that ignore direct writes
// ═══════════════════════════════════════════════════════════════════════════

function injectPageScriptlet(action, data) {
  const script = document.createElement("script");
  script.textContent = `(function(){
    try {
      var v = document.querySelector('video');
      if (!v) return;
      if (${JSON.stringify(action)} === "applyState") {
        var d = ${JSON.stringify(data)};
        try { v.currentTime = d.currentTime; } catch(e) {}
        if (d.isPlaying) { try { v.play(); } catch(e) {} }
        else { try { v.pause(); } catch(e) {} }
      }
    } catch(e) {}
  })();`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// ═══════════════════════════════════════════════════════════════════════════
// Clock sync — Cristian's algorithm with NTP-style low-RTT filtering
// ═══════════════════════════════════════════════════════════════════════════

function runClockSync() {
  if (!socket) return;
  socket.emit("clock:req", { t1: Date.now() });
}

function onClockResponse(p) {
  const t4 = Date.now();
  const rtt = t4 - p.t1;
  clockSamples.push({ t0: p.t1, t1: t4, serverTime: p.t3 });
  if (clockSamples.length > 8) clockSamples.shift();
  // Lowest-RTT sample is most trustworthy (NTP convention)
  const sorted = clockSamples.slice().sort((a, b) => (a.t1 - a.t0) - (b.t1 - b.t0));
  const best = sorted[0];
  if (best) {
    const bestRtt = best.t1 - best.t0;
    const bestOffset = best.serverTime + bestRtt / 2 - best.t1;
    stats.clockOffset = bestOffset;
    stats.rtt = bestRtt;
    stats.drift = Math.abs(bestOffset);
  }
  updateOverlay();
}

// ═══════════════════════════════════════════════════════════════════════════
// Connection lifecycle
// ═══════════════════════════════════════════════════════════════════════════

function connect() {
  if (!roomCtx) {
    agentState = "DISCONNECTED";
    updateOverlay();
    showNoRoomOverlay();
    return;
  }
  agentState = "CONNECTING";
  updateOverlay();

  getIo().then((ioFn) => {
    socket = ioFn(roomCtx.syncUrl, {
      path: "/",
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: RECONNECT_BASE_MS,
      reconnectionDelayMax: RECONNECT_MAX_MS,
    });

    socket.on("connect", () => {
      stats.connected = true;
      reconnectDelay = RECONNECT_BASE_MS;
      agentState = videoEl ? "SYNCING" : "WAITING_FOR_VIDEO";
      updateOverlay();
      socket.emit("room:join", {
        roomId: roomCtx.roomId,
        userId: roomCtx.userId,
        name: roomCtx.userName,
        clientType: "agent",
        color: roomCtx.color,
      });
      runClockSync();
    });

    socket.on("disconnect", () => {
      stats.connected = false;
      agentState = "RECOVERY";
      updateOverlay();
    });

    socket.on("connect_error", () => {
      stats.connected = false;
      agentState = "RECOVERY";
      updateOverlay();
    });

    socket.on("clock:res", onClockResponse);

    socket.on("room:joined", (p) => {
      stats.participants = p.participants ? p.participants.length : 0;
      if (p.you && p.you.color) roomCtx.color = p.you.color;
      playback = p.playback || playback;
      if (p.playback && videoEl) applyState(p.playback);
      updateOverlay();
    });

    socket.on("presence:update", (p) => {
      stats.participants = p.participants ? p.participants.length : 0;
      updateOverlay();
    });

    socket.on("state:sync", (p) => {
      playback = p;
      if (videoEl) applyState(p);
    });

    socket.on("source:set", (p) => {
      // Server tells us the canonical URL for this room
      if (p.url && roomCtx.cinevoUrl && !sameUrl(p.url, roomCtx.cinevoUrl)) {
        // We're on the wrong page — navigate
        window.location.href = p.url;
      }
    });

    socket.on("chat:new", (m) => addChatMessage(m));
    socket.on("chat:system", (m) => addChatMessage({ userId: "system", text: m.text, at: m.at }));

    socket.on("reaction", (r) => {
      // Could render floating emoji — skip for v1
    });
  }).catch((err) => {
    console.error("[WatchParty] socket.io load failed:", err);
    agentState = "DISCONNECTED";
    updateOverlay();
    // Retry
    setTimeout(connect, 5000);
  });

  // Clock sync loop
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(runClockSync, CLOCK_SYNC_INTERVAL_MS);

  // Drift check loop
  if (driftInterval) clearInterval(driftInterval);
  driftInterval = setInterval(checkDrift, DRIFT_CHECK_INTERVAL_MS);
}

function sameUrl(a, b) {
  try { return new URL(a).pathname === new URL(b).pathname; } catch { return a === b; }
}

// ═══════════════════════════════════════════════════════════════════════════
// No-room overlay — shown when the extension loads on cinevo.nl without context
// ═══════════════════════════════════════════════════════════════════════════

function showNoRoomOverlay() {
  ensureOverlay();
  const status = document.getElementById("wp-status");
  status.textContent = "No room — open WatchParty first";
  // Add a link back to the app
  if (!document.getElementById("wp-no-room-link")) {
    const link = document.createElement("a");
    link.id = "wp-no-room-link";
    link.href = "http://localhost:3000";
    link.target = "_blank";
    link.textContent = "Open WatchParty →";
    link.className = "wp-link";
    document.getElementById("wp-pill").appendChild(link);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MutationObserver — re-discover video on SPA navigation / ad insert
// ═══════════════════════════════════════════════════════════════════════════

function startObserver() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    const v = findMainVideo();
    if (v && v !== videoEl) {
      attachVideo(v);
    }
    checkForAds();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

function bootstrap() {
  ensureOverlay();
  // Read room context from chrome.storage.session
  chrome.storage.session.get([
    "wp:roomId", "wp:userId", "wp:userName", "wp:syncUrl", "wp:cinevoUrl", "wp:color"
  ], (ctx) => {
    if (ctx["wp:roomId"] && ctx["wp:userId"]) {
      roomCtx = {
        roomId: ctx["wp:roomId"],
        userId: ctx["wp:userId"],
        userName: ctx["wp:userName"] || "Guest",
        syncUrl: ctx["wp:syncUrl"] || "http://localhost:3003",
        cinevoUrl: ctx["wp:cinevoUrl"] || "",
        color: ctx["wp:color"] || "#a78bfa",
      };
      connect();
    } else {
      showNoRoomOverlay();
    }
  });

  // Listen for context changes (e.g. user joins a new room from the app)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    if (changes["wp:roomId"]) {
      // Room changed — reconnect
      if (socket) { socket.disconnect(); socket = null; }
      bootstrap();
    }
  });

  // Find video
  const v = findMainVideo();
  if (v) attachVideo(v);
  startObserver();

  // Periodic ad check (some ads don't trigger mutations)
  setInterval(checkForAds, 2000);
}

bootstrap();
