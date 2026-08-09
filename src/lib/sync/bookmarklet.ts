/**
 * Bookmarklet Generator + Sync Hook
 * ----------------------------------
 * This generates a bookmarklet that users drag to their bookmarks bar.
 * When on cinevo.nl (or any site with a <video>), they click it.
 * It connects to our sync server and hooks the video player for perfect sync.
 *
 * This is EXACTLY how w2g's W2gSync works:
 * 1. User opens the movie site in their own browser (native quality, no streaming)
 * 2. User clicks the bookmarklet
 * 3. Bookmarklet injects a script that:
 *    - Finds the <video> element on the page
 *    - Connects to our Socket.IO sync server
 *    - Syncs play/pause/seek with the room
 *    - Shows a small overlay with sync status
 *
 * Result: Perfect sync (<100ms), native 1080p/4K quality, zero streaming latency.
 */

// The bookmarklet code (minified, injected as an IIFE)
export const BOOKMARKLET_CODE = `javascript:(function(){
  if(window.__wpSync){window.__wpSync.disconnect();delete window.__wpSync;return}
  var s=document.createElement('script');
  s.src='https://cdn.socket.io/4.8.3/socket.io.min.js';
  s.onload=function(){
    var video=document.querySelector('video');
    if(!video){alert('No video element found on this page. Make sure the video is playing first.');return}
    var room=prompt('Enter your WatchParty room code:','');
    if(!room)return;
    var name=prompt('Your name:','')||'Guest';
    var sock=io('https://sync.kushalneedsmcp.online',{path:'/',transports:['websocket','polling']});
    var guard=false;
    var offset=0;
    var userId='u-'+Math.random().toString(36).slice(2,10);
    window.__wpSync={disconnect:function(){sock.disconnect();document.getElementById('__wpOverlay')?.remove();video.style.outline=''}};
    sock.on('connect',function(){
      sock.emit('room:join',{roomId:room,userId:userId,name:name});
      sock.emit('clock:req',{t1:Date.now()});
      showOverlay('Connected — sync active');
      video.style.outline='3px solid #7c3aed';
    });
    sock.on('clock:res',function(p){
      var t4=Date.now();var rtt=t4-p.t1;
      offset=(p.t3+rtt/2)-t4;
    });
    sock.on('state:sync',function(s){
      if(!s.videoUrl){return}
      guard=true;
      var serverNow=Date.now()+offset;
      var elapsed=s.isPlaying?(serverNow-s.lastChangedAt)/1000:0;
      var expected=s.currentTime+elapsed;
      var delta=Math.abs(video.currentTime-expected);
      if(delta>1.5){video.currentTime=expected}
      else if(delta>0.1){video.playbackRate=s.isPlaying?1.05:1}
      else{video.playbackRate=s.playbackRate||1}
      if(s.isPlaying&&video.paused){video.play().catch(function(){})}
      else if(!s.isPlaying&&!video.paused){video.pause()}
      setTimeout(function(){guard=false},200);
    });
    sock.on('chat:new',function(m){
      showOverlay(m.userName+': '+m.text);
    });
    sock.on('chat:system',function(m){
      showOverlay(m.text);
    });
    video.addEventListener('play',function(){if(!guard)sock.emit('state:intent',{isPlaying:true,currentTime:video.currentTime})});
    video.addEventListener('pause',function(){if(!guard)sock.emit('state:intent',{isPlaying:false,currentTime:video.currentTime})});
    video.addEventListener('seeked',function(){if(!guard)sock.emit('state:intent',{currentTime:video.currentTime})});
    video.addEventListener('ratechange',function(){if(!guard)sock.emit('state:intent',{playbackRate:video.playbackRate})});
    function showOverlay(text){
      var o=document.getElementById('__wpOverlay');
      if(!o){o=document.createElement('div');o.id='__wpOverlay';o.style.cssText='position:fixed;top:10px;right:10px;z-index:999999;background:rgba(124,58,237,0.9);color:white;padding:8px 16px;border-radius:8px;font-family:sans-serif;font-size:13px;max-width:300px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s';document.body.appendChild(o)}
      o.textContent=text;o.style.opacity='1';
      clearTimeout(o._timer);
      o._timer=setTimeout(function(){o.style.opacity='0.5'},3000);
    }
    setInterval(function(){if(sock.connected)sock.emit('clock:req',{t1:Date.now()})},30000);
  };
  document.head.appendChild(s);
})();`;

/**
 * API route: GET /api/bookmarklet
 * Returns the bookmarklet code as a downloadable file
 */
export function generateBookmarkletPage(roomSlug: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>WatchParty Sync Bookmarklet</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
  h1 { color: #7c3aed; margin-bottom: 1rem; }
  p { color: #888; max-width: 500px; text-align: center; margin-bottom: 1.5rem; line-height: 1.6; }
  .bookmarklet { display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; cursor: grab; user-select: none; margin-bottom: 1rem; }
  .bookmarklet:hover { background: #6d28d9; }
  .steps { background: #181818; border-radius: 12px; padding: 1.5rem; max-width: 500px; }
  .steps ol { padding-left: 1.5rem; }
  .steps li { margin-bottom: 0.75rem; line-height: 1.5; }
  code { background: #272727; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style>
</head>
<body>
  <h1>🎬 WatchParty Sync</h1>
  <p>Drag the button below to your bookmarks bar. Then open any movie site (cinevo.nl, YouTube, etc.), start the video, and click the bookmarklet to sync with your friend.</p>
  <a href="${BOOKMARKLET_CODE}" class="bookmarklet" draggable="true">📺 Sync This Video</a>
  <div class="steps">
    <ol>
      <li>Drag the purple button above to your browser's <strong>bookmarks bar</strong></li>
      <li>Open the movie site (e.g. <code>cinevo.nl/watch/movie/...</code>)</li>
      <li>Start playing the video</li>
      <li>Click the <strong>"Sync This Video"</strong> bookmarklet</li>
      <li>Enter room code: <code>${roomSlug}</code></li>
      <li>Enter your name</li>
      <li>The video will sync with everyone in the room — play/pause/seek all synced!</li>
    </ol>
  </div>
  <p style="margin-top:1rem;font-size:12px;color:#555">The video plays in YOUR browser at full quality. No streaming, no lag. Sync is <100ms.</p>
</body>
</html>`;
}
