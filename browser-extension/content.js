// content.js — WatchParty Sync Extension
// Auto-injected on every page. Detects <video> elements and syncs them
// with the WatchParty room. Shows a floating "Sync" button when a video is found.

(function() {
  // Don't run on our own domain
  if (window.location.hostname.includes('kushalneedsmcp.online') || 
      window.location.hostname.includes('wp.') ||
      window.location.hostname === 'localhost') return;

  let sock = null;
  let video = null;
  let guard = false;
  let offset = 0;
  let overlay = null;
  let connected = false;
  let roomCode = '';
  let userName = '';
  let clockSamples = [];
  let clockInterval = null;

  // Load saved room code + name from storage
  chrome.storage.local.get(['wpRoom', 'wpName'], function(result) {
    roomCode = result.wpRoom || '';
    userName = result.wpName || '';
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.action === 'connect') {
      roomCode = msg.room;
      userName = msg.name;
      chrome.storage.local.set({ wpRoom: roomCode, wpName: userName });
      connectSync();
      sendResponse({ ok: true });
    } else if (msg.action === 'disconnect') {
      disconnectSync();
      sendResponse({ ok: true });
    } else if (msg.action === 'getStatus') {
      sendResponse({ connected: connected, hasVideo: !!video, room: roomCode });
    }
    return true;
  });

  // Auto-detect video elements
  function findVideo() {
    video = document.querySelector('video');
    if (video) {
      showSyncButton();
      if (roomCode) connectSync();
    }
  }

  // Watch for dynamically loaded videos
  const observer = new MutationObserver(function() {
    if (!video) findVideo();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check + delayed check (for SPAs)
  findVideo();
  setTimeout(findVideo, 2000);
  setTimeout(findVideo, 5000);

  function showSyncButton() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'watchparty-sync-btn';
    overlay.innerHTML = `
      <div style="
        position: fixed; top: 10px; right: 10px; z-index: 999999;
        background: #7c3aed; color: white; padding: 8px 16px;
        border-radius: 8px; font-family: -apple-system, sans-serif;
        font-size: 13px; font-weight: 600; cursor: pointer;
        box-shadow: 0 4px 12px rgba(124,58,237,0.4);
        display: flex; align-items: center; gap: 8px;
        transition: all 0.2s;
      " onmouseover="this.style.background='#6d28d9'" onmouseout="this.style.background='#7c3aed'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        <span id="wp-status">Sync with WatchParty</span>
      </div>
    `;
    overlay.onclick = function() {
      if (connected) {
        disconnectSync();
      } else if (roomCode) {
        connectSync();
      } else {
        // Trigger popup
        chrome.runtime.sendMessage({ action: 'openPopup' });
      }
    };
    document.body.appendChild(overlay);
  }

  function updateStatus(text, color) {
    const span = document.getElementById('wp-status');
    if (span) span.textContent = text;
    if (overlay) overlay.style.background = color || '#7c3aed';
  }

  function getSyncUrl() {
    var h = window.location.hostname || '';
    var proto = window.location.protocol || 'https:';
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3003';
    if (h.startsWith('preview-') || h.includes('.space-z.ai')) return '/?XTransformPort=3003';
    var p = h.split('.');
    if (p.length >= 3) {
      p[0] = 'sync';
      return proto + '//' + p.join('.');
    }
    return proto + '//sync.' + h;
  }

  function connectSync() {
    if (!video) { findVideo(); if (!video) return; }
    if (sock) sock.disconnect();

    updateStatus('Connecting...', '#f59e0b');

    // Load socket.io from CDN
    if (!window.io) {
      var s = document.createElement('script');
      s.src = 'https://cdn.socket.io/4.8.3/socket.io.min.js';
      s.onload = function() { doConnect(); };
      document.head.appendChild(s);
    } else {
      doConnect();
    }
  }

  function processClockResponse(p) {
    var t4 = Date.now();
    var t0 = p.t0 !== undefined ? p.t0 : p.t1;
    var t1 = p.t2;
    var t2 = p.t3;
    var t3 = t4;
    var serverProcessing = Math.max(0, t2 - t1);
    var rtt = Math.max(0, (t3 - t0) - serverProcessing);
    var rawOffset = ((t1 - t0) + (t2 - t3)) / 2;

    // Outlier rejection (>500ms)
    if (rtt > 500) return;

    clockSamples.push({ rtt: rtt, offset: rawOffset });
    if (clockSamples.length > 8) clockSamples.shift();

    var best = clockSamples.reduce(function(min, s) { return s.rtt < min.rtt ? s : min; }, clockSamples[0]);
    if (best) {
      offset = clockSamples.length === 1 ? best.offset : (0.2 * best.offset + 0.8 * offset);
      if (sock && sock.connected) {
        sock.emit('heartbeat', { rtt: best.rtt, clockOffset: offset });
      }
    }
  }

  function doConnect() {
    var syncUrl = getSyncUrl();
    sock = io(syncUrl, {
      path: '/',
      transports: ['websocket', 'polling']
    });

    var userId = 'ext-' + Math.random().toString(36).slice(2, 10);
    clockSamples = [];

    sock.on('connect', function() {
      connected = true;
      sock.emit('room:join', { roomId: roomCode, userId: userId, name: userName });
      sock.emit('clock:req', { t0: Date.now(), t1: Date.now() });
      updateStatus('● Synced — Room: ' + roomCode, '#10b981');
      if (video) video.style.outline = '3px solid #10b981';
    });

    sock.on('clock:res', processClockResponse);

    sock.on('state:sync', function(s) {
      if (!video || (!s.videoUrl && s.videoType !== 'file')) return;
      guard = true;
      var desiredRate = s.playbackRate || 1;
      var serverNow = Date.now() + offset;
      var elapsed = s.isPlaying ? (serverNow - s.lastChangedAt) / 1000 : 0;
      var expected = s.currentTime + elapsed * desiredRate;
      var delta = Math.abs(video.currentTime - expected);

      // Deadband 0.1s, hard seek 1.0s, rate clamping [0.95, 1.05]
      if (delta > 1.0) {
        video.currentTime = expected;
        video.playbackRate = desiredRate;
      } else if (delta > 0.1) {
        if (video.currentTime < expected) {
          video.playbackRate = Math.min(desiredRate * 1.05, 1.05);
        } else {
          video.playbackRate = Math.max(desiredRate * 0.95, 0.95);
        }
      } else {
        video.playbackRate = desiredRate;
      }

      if (s.isPlaying && video.paused) {
        video.play().catch(function() {});
      } else if (!s.isPlaying && !video.paused) {
        video.pause();
      }

      setTimeout(function() { guard = false; }, 200);
    });

    sock.on('REC:play', function() {
      if (video && video.paused) video.play().catch(function() {});
    });
    sock.on('REC:pause', function() {
      if (video && !video.paused) video.pause();
    });
    sock.on('REC:seek', function(p) {
      if (video && typeof p?.time === 'number') {
        video.currentTime = p.time;
        if (p.playing && video.paused) video.play().catch(function() {});
        else if (!p.playing && !video.paused) video.pause();
      }
    });

    sock.on('chat:new', function(m) {
      showChatBubble(m.userName + ': ' + m.text);
    });

    sock.on('chat:system', function(m) {
      showChatBubble(m.text);
    });

    // Hook video events
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeek);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    // Periodic clock sync (every 5s)
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(function() {
      if (sock && sock.connected) sock.emit('clock:req', { t0: Date.now(), t1: Date.now() });
    }, 5000);
  }

  function onPlay() {
    if (!guard && sock) {
      sock.emit('CMD:play', {});
      sock.emit('state:intent', { isPlaying: true, currentTime: video.currentTime });
    }
  }
  function onPause() {
    if (!guard && sock) {
      sock.emit('CMD:pause', {});
      sock.emit('state:intent', { isPlaying: false, currentTime: video.currentTime });
    }
  }
  function onSeek() {
    if (!guard && sock) {
      sock.emit('CMD:seek', { time: video.currentTime, playing: !video.paused });
      sock.emit('state:intent', { currentTime: video.currentTime });
    }
  }
  function onRate() {
    if (!guard && sock) sock.emit('state:intent', { playbackRate: video.playbackRate });
  }
  function onWaiting() {
    if (!guard && sock) sock.emit('buffer:event', { type: 'waiting', position: video.currentTime });
  }
  function onPlaying() {
    if (!guard && sock) sock.emit('buffer:event', { type: 'playing', position: video.currentTime });
  }

  function disconnectSync() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
    if (sock) { sock.disconnect(); sock = null; }
    connected = false;
    updateStatus('Sync with WatchParty', '#7c3aed');
    if (video) {
      video.style.outline = '';
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
    }
  }

  function showChatBubble(text) {
    var bubble = document.createElement('div');
    bubble.style.cssText = 'position:fixed;top:50px;right:10px;z-index:999999;background:rgba(0,0,0,0.85);color:white;padding:8px 14px;border-radius:8px;font-family:sans-serif;font-size:12px;max-width:280px;opacity:0;transition:opacity 0.3s;margin-bottom:4px';
    bubble.textContent = text;
    document.body.appendChild(bubble);
    setTimeout(function() { bubble.style.opacity = '1'; }, 10);
    setTimeout(function() { bubble.style.opacity = '0'; setTimeout(function() { bubble.remove(); }, 300); }, 4000);
  }
})();
