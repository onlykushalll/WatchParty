/**
 * Virtual Browser Service for WatchParty
 * ---------------------------------------
 * Runs on port 3004. Uses puppeteer-core to control the user's existing
 * Chrome installation, streams screenshots as MJPEG over HTTP, and accepts
 * mouse/keyboard input over WebSocket.
 *
 * Works through Cloudflare Tunnel (HTTP + WebSocket, no UDP/WebRTC needed).
 *
 * Usage: bun run dev  (or node index.js)
 * Access: http://localhost:3004 or https://vm.kushalneedsmcp.online
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer, { Browser, Page } from "puppeteer-core";
import { join } from "path";

const PORT = 3004;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 15; // screenshots per second
const JPEG_QUALITY = 70;

// ─── State ───
let browser: Browser | null = null;
let page: Page | null = null;
let lastFrame: Buffer | null = null;
let capturing = false;

// Connected WS clients (for input + frame distribution)
const clients = new Set<WebSocket>();

// ─── Browser launch ───
async function launchBrowser() {
  console.log("[vm] Launching Chrome…");
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      // Stealth: avoid headless detection by Cloudflare/bot protection
      "--disable-blink-features=AutomationControlled",
      "--exclude-switches=enable-automation",
      "--disable-features=IsolateOrigins,site-per-process",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  // Remove webdriver property to avoid detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Overwrite the `plugins` property to use a custom getter.
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    // Overwrite the `languages` property to use a custom getter.
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  }).catch(() => {});

  // Navigate to a default page
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("[vm] Chrome launched, starting capture loop");

  // Screenshot capture loop
  capturing = true;
  const captureLoop = async () => {
    while (capturing && page) {
      try {
        const frame = await page.screenshot({
          type: "jpeg",
          quality: JPEG_QUALITY,
          clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
        });
        lastFrame = frame as Buffer;
        // Broadcast to all WS clients
        const msg = Buffer.concat([
          Buffer.from([1]), // type=1 (frame)
          lastFrame,
        ]);
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
          }
        }
      } catch (e) {
        // Page might be navigating, skip this frame
      }
      await new Promise((r) => setTimeout(r, 1000 / FPS));
    }
  };
  captureLoop();
}

// ─── HTTP server (MJPEG stream + web UI) ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // CORS + no-cache headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vm-browser", clients: clients.size }));
    return;
  }

  // MJPEG stream endpoint (fallback for non-WS clients)
  if (url.pathname === "/stream") {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-store",
    });
    const interval = setInterval(() => {
      if (lastFrame) {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${lastFrame.length}\r\n\r\n`);
        res.write(lastFrame);
        res.write("\r\n");
      }
    }, 1000 / FPS);
    req.on("close", () => clearInterval(interval));
    return;
  }

  // Get current URL
  if (url.pathname === "/url") {
    const currentUrl = page?.url() || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: currentUrl }));
    return;
  }

  // Navigate to a new URL (POST)
  if (url.pathname === "/navigate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { url: navUrl } = JSON.parse(body);
        if (navUrl && page) {
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, url: page.url() }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "Missing url" }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // Serve the web UI (HTML page with canvas + input handlers)
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_UI);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket server (input + frame streaming) ───
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[vm] WS client connected (${clients.size} total)`);

  // Send the latest frame immediately
  if (lastFrame) {
    ws.send(Buffer.concat([Buffer.from([1]), lastFrame]));
  }

  ws.on("message", async (data: Buffer) => {
    if (!page) return;
    try {
      const type = data[0]; // message type
      const payload = data.slice(1).toString("utf-8");

      if (type === 2) {
        // Mouse move
        const { x, y } = JSON.parse(payload);
        await page.mouse.move(x, y);
      } else if (type === 3) {
        // Mouse click
        const { x, y, button } = JSON.parse(payload);
        await page.mouse.click(x, y, { button: button || "left" });
      } else if (type === 4) {
        // Mouse scroll
        const { deltaX, deltaY } = JSON.parse(payload);
        await page.mouse.wheel({ deltaX, deltaY });
      } else if (type === 5) {
        // Keyboard input
        const { key } = JSON.parse(payload);
        await page.keyboard.press(key);
      } else if (type === 6) {
        // Type text
        const { text } = JSON.parse(payload);
        await page.keyboard.type(text);
      } else if (type === 7) {
        // Navigate
        const { url } = JSON.parse(payload);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      } else if (type === 8) {
        // Go back
        await page.goBack();
      } else if (type === 9) {
        // Go forward
        await page.goForward();
      } else if (type === 10) {
        // Reload
        await page.reload();
      }
    } catch (e) {
      // Ignore input errors (page might be navigating)
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[vm] WS client disconnected (${clients.size} total)`);
  });
});

// ─── Web UI (HTML + JS) ───
const HTML_UI = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virtual Browser</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; }
  body { display: flex; flex-direction: column; }
  #toolbar { display: flex; gap: 4px; padding: 6px 8px; background: #181818; border-bottom: 1px solid #272727; align-items: center; }
  #toolbar button { padding: 6px 10px; border: none; border-radius: 6px; background: #272727; color: #e0e0e0; cursor: pointer; font-size: 13px; transition: background 0.15s; }
  #toolbar button:hover { background: #383838; }
  #toolbar input { flex: 1; padding: 6px 12px; border: 1px solid #333; border-radius: 6px; background: #0e0e0e; color: #e0e0e0; font-size: 13px; outline: none; }
  #toolbar input:focus { border-color: #7c3aed; }
  #status { padding: 4px 10px; font-size: 11px; color: #666; }
  #status .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; margin-right: 4px; vertical-align: middle; }
  #stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
  #canvas-wrap { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  #screen { max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; background: #000; }
  #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #555; font-size: 14px; text-align: center; }
  #loading .spinner { width: 32px; height: 32px; border: 3px solid #272727; border-top-color: #7c3aed; border-radius: 50%; margin: 0 auto 12px; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="goBack()" title="Back">←</button>
  <button onclick="goFwd()" title="Forward">→</button>
  <button onclick="reload()" title="Reload">⟳</button>
  <input id="urlbar" placeholder="Enter URL and press Enter…" onkeydown="if(event.key==='Enter')navigate(this.value)" spellcheck="false">
  <button onclick="navigate(document.getElementById('urlbar').value)" style="background:#7c3aed;color:#fff;">Go</button>
  <button onclick="goHome()" title="Home">⌂</button>
</div>
<div id="stage">
  <div id="canvas-wrap">
    <div id="loading"><div class="spinner"></div>Connecting to virtual browser…</div>
    <canvas id="screen" style="display:none;"></canvas>
  </div>
</div>
<div id="status"><span class="dot"></span><span id="status-text">1920×1080 · 15fps · 0 clients</span></div>
<script>
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const loading = document.getElementById('loading');
const urlbar = document.getElementById('urlbar');
const statusText = document.getElementById('status-text');

const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(wsProto + '//' + location.host + '/ws');
ws.binaryType = 'arraybuffer';

let frameCount = 0;
let lastFpsTime = Date.now();
let fps = 0;

ws.onopen = () => { statusText.textContent = '1920×1080 · 15fps · connected'; };

ws.onmessage = (e) => {
  const data = new Uint8Array(e.data);
  if (data[0] === 1) {
    // Frame
    if (loading.style.display !== 'none') { loading.style.display = 'none'; canvas.style.display = 'block'; }
    const blob = new Blob([data.slice(1)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width) canvas.width = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      frameCount++;
      const now = Date.now();
      if (now - lastFpsTime > 1000) { fps = frameCount; frameCount = 0; lastFpsTime = now; statusText.textContent = '1920×1080 · ' + fps + 'fps · live'; }
    };
    img.src = url;
  }
};

ws.onclose = () => { loading.style.display = 'block'; loading.innerHTML = '<div class="spinner"></div>Reconnecting…'; canvas.style.display = 'none'; statusText.textContent = 'disconnected'; };
ws.onerror = () => { loading.innerHTML = '<div class="spinner"></div>Connection error'; };

// Mouse input — map screen coords to canvas coords
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  return { x: Math.round(x), y: Math.round(y) };
}

canvas.addEventListener('mousemove', (e) => {
  const { x, y } = getCoords(e);
  ws.send(new Uint8Array([2, ...new TextEncoder().encode(JSON.stringify({x, y}))]));
});
canvas.addEventListener('mousedown', (e) => {
  const { x, y } = getCoords(e);
  const btn = e.button === 2 ? 'right' : 'left';
  ws.send(new Uint8Array([3, ...new TextEncoder().encode(JSON.stringify({x, y, button: btn}))]));
  e.preventDefault();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  ws.send(new Uint8Array([4, ...new TextEncoder().encode(JSON.stringify({deltaX: e.deltaX, deltaY: e.deltaY}))]));
  e.preventDefault();
}, { passive: false });

// Keyboard input
document.addEventListener('keydown', (e) => {
  if (document.activeElement === urlbar) return;
  ws.send(new Uint8Array([5, ...new TextEncoder().encode(JSON.stringify({key: e.key}))]));
  if (e.key.length === 1 || ['Backspace','Tab','Enter','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});

// Navigation
function navigate(url) {
  url = url.trim();
  if (!url) return;
  if (!url.match(/^https?:\\/\\//)) url = 'https://' + url;
  urlbar.value = url;
  ws.send(new Uint8Array([7, ...new TextEncoder().encode(JSON.stringify({url}))]));
}
function goBack() { ws.send(new Uint8Array([8])); }
function goFwd() { ws.send(new Uint8Array([9])); }
function reload() { ws.send(new Uint8Array([10])); }
function goHome() { navigate('https://www.google.com'); }

// Update URL bar when page changes
setInterval(() => {
  if (ws.readyState === 1) {
    fetch('/url').then(r => r.json()).then(d => { if (d.url && d.url !== urlbar.value && document.activeElement !== urlbar) urlbar.value = d.url; }).catch(() => {});
  }
}, 3000);
</script>
</body>
</html>`;

// ─── Start ───
server.listen(PORT, async () => {
  console.log(`[vm] HTTP server on port ${PORT}`);
  try {
    await launchBrowser();
    console.log(`[vm] Virtual browser ready at http://localhost:${PORT}`);
  } catch (e) {
    console.error("[vm] Failed to launch Chrome:", e);
    console.error("[vm] Make sure Chrome is installed at:", CHROME_PATH);
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  capturing = false;
  if (browser) await browser.close();
  process.exit(0);
});
