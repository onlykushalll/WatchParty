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

  function doConnect() {
    sock = io('https://sync.kushalneedsmcp.online', {
      path: '/',
      transports: ['websocket', 'polling']
    });

    var userId = 'ext-' + Math.random().toString(36).slice(2, 10);

    sock.on('connect', function() {
      connected = true;
      sock.emit('room:join', { roomId: roomCode, userId: userId, name: userName });
      sock.emit('clock:req', { t1: Date.now() });
      updateStatus('● Synced — Room: ' + roomCode, '#10b981');
      if (video) video.style.outline = '3px solid #10b981';
    });

    sock.on('clock:res', function(p) {
      var t4 = Date.now();
      var rtt = t4 - p.t1;
      offset = (p.t3 + rtt / 2) - t4;
    });

    sock.on('state:sync', function(s) {
      if (!video || !s.videoUrl) return;
      guard = true;
      var serverNow = Date.now() + offset;
      var elapsed = s.isPlaying ? (serverNow - s.lastChangedAt) / 1000 : 0;
      var expected = s.currentTime + elapsed;
      var delta = Math.abs(video.currentTime - expected);

      if (delta > 1.5) {
        video.currentTime = expected;
      } else if (delta > 0.1) {
        video.playbackRate = s.isPlaying ? 1.05 : 1;
      } else {
        video.playbackRate = s.playbackRate || 1;
      }

      if (s.isPlaying && video.paused) {
        video.play().catch(function() {});
      } else if (!s.isPlaying && !video.paused) {
        video.pause();
      }

      setTimeout(function() { guard = false; }, 200);
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

    // Periodic clock sync
    setInterval(function() {
      if (sock && sock.connected) sock.emit('clock:req', { t1: Date.now() });
    }, 30000);
  }

  function onPlay() { if (!guard && sock) sock.emit('state:intent', { isPlaying: true, currentTime: video.currentTime }); }
  function onPause() { if (!guard && sock) sock.emit('state:intent', { isPlaying: false, currentTime: video.currentTime }); }
  function onSeek() { if (!guard && sock) sock.emit('state:intent', { currentTime: video.currentTime }); }
  function onRate() { if (!guard && sock) sock.emit('state:intent', { playbackRate: video.playbackRate }); }

  function disconnectSync() {
    if (sock) { sock.disconnect(); sock = null; }
    connected = false;
    updateStatus('Sync with WatchParty', '#7c3aed');
    if (video) video.style.outline = '';
    if (video) {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('ratechange', onRate);
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
