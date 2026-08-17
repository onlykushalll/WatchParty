// popup.js — WatchParty Sync Extension popup

document.addEventListener('DOMContentLoaded', function() {
  var statusEl = document.getElementById('status');
  var roomInput = document.getElementById('room');
  var nameInput = document.getElementById('name');
  var connectBtn = document.getElementById('connect');
  var disconnectBtn = document.getElementById('disconnect');

  // Load saved values
  chrome.storage.local.get(['wpRoom', 'wpName'], function(result) {
    roomInput.value = result.wpRoom || '';
    nameInput.value = result.wpName || '';
  });

  // Check current status
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, function(response) {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'No video detected on this page';
        statusEl.className = 'status disconnected';
        connectBtn.disabled = true;
        return;
      }
      if (response && response.connected) {
        statusEl.textContent = '● Synced — Room: ' + response.room;
        statusEl.className = 'status connected';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'block';
        roomInput.value = response.room || '';
      } else if (response && response.hasVideo) {
        statusEl.textContent = 'Video detected — enter room code to sync';
        statusEl.className = 'status disconnected';
        if (response.room) roomInput.value = response.room;
      } else {
        statusEl.textContent = 'No video detected on this page';
        statusEl.className = 'status disconnected';
      }
    });
  });

  connectBtn.addEventListener('click', function() {
    var room = roomInput.value.trim();
    var name = nameInput.value.trim();
    if (!room) { roomInput.focus(); return; }
    if (!name) { nameInput.focus(); return; }

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'connect', room: room, name: name }, function(response) {
        if (response && response.ok) {
          statusEl.textContent = '● Synced — Room: ' + room;
          statusEl.className = 'status connected';
          connectBtn.style.display = 'none';
          disconnectBtn.style.display = 'block';
        } else {
          statusEl.textContent = 'Failed to connect — is there a video on this page?';
          statusEl.className = 'status disconnected';
        }
      });
    });
  });

  disconnectBtn.addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'disconnect' }, function() {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'status disconnected';
        connectBtn.style.display = 'block';
        disconnectBtn.style.display = 'none';
      });
    });
  });
});
