/**
 * Dedicated Chrome VNC Service
 * --------------------------------
 * Runs a SEPARATE Chrome instance (not the user's desktop) with a
 * dedicated user-data-dir. Uses a VNC-like screenshot stream but
 * ONLY captures the Chrome window — not the entire desktop.
 *
 * This fixes two problems:
 * 1. Privacy: Only shows Chrome, not the user's personal desktop/apps
 * 2. Performance: Dedicated window = smaller capture area = less lag
 *
 * Uses puppeteer-core to control a real (non-headless) Chrome with
 * stealth flags to avoid bot detection.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer, { Browser, Page } from "puppeteer-core";
import { FloorControlManager, normalizeCoordinates } from "./index";
import os from "os";
import path from "path";

const PORT = Number(process.env.PORT || process.env.VM_PORT || 3004);
const DEFAULT_CHROME_PATH =
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/chromium";

const CHROME_PATH = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
const IS_HEADLESS = process.env.HEADLESS !== "false";
const WIDTH = 1600;
const HEIGHT = 900;
const FPS = 24;
const JPEG_QUALITY = 80;

// ─── State ───
let browser: Browser | null = null;
let page: Page | null = null;
let lastFrame: Buffer | null = null;
let capturing = false;
const clients = new Set<WebSocket>();
const floorManager = new FloorControlManager();

function broadcastControlState() {
  const state = floorManager.getControlState();
  const msg = Buffer.concat([
    Buffer.from([129]),
    Buffer.from(JSON.stringify(state)),
  ]);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastGrantControl(controllerId: string | null) {
  const msg = Buffer.concat([
    Buffer.from([128]),
    Buffer.from(JSON.stringify({ controllerId })),
  ]);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ─── Browser launch ───
async function launchBrowser() {
  console.log(`[vm] Launching dedicated Chrome via executable: ${CHROME_PATH} (Headless: ${IS_HEADLESS})…`);

  // Use a dedicated user-data-dir in system temp directory so this Chrome is completely separate
  // from the user's personal Chrome — no cookies, no history, no tabs.
  const userDataDir = path.join(os.tmpdir(), "vm-chrome-profile");

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: IS_HEADLESS ? ("shell" as any) : false,
    userDataDir,
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      `--window-position=0,0`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--disable-translate",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      "--metrics-recording-only",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--exclude-switches=enable-automation",
      // Low-RAM optimization flags from the research report
      "--renderer-process-limit=2",
      '--js-flags="--max-old-space-size=512"',
      "--memory-pressure-off",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=Translate,BackForwardCache,MediaRouter",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio", // We don't stream audio via screenshots
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  // Anti-detection: remove webdriver property
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  }).catch(() => {});

  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("[vm] Dedicated Chrome launched — streaming Chrome window only");

  // Screenshot capture loop — captures only the Chrome page, NOT the desktop
  capturing = true;
  const captureLoop = async () => {
    let lastCapture = 0;
    while (capturing && page) {
      const now = Date.now();
      const elapsed = now - lastCapture;
      if (elapsed < 1000 / FPS) {
        await new Promise((r) => setTimeout(r, 1000 / FPS - elapsed));
        continue;
      }
      lastCapture = now;
      try {
        const frame = await page.screenshot({
          type: "jpeg",
          quality: JPEG_QUALITY,
          clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
          optimizeForSpeed: true,
        });
        lastFrame = frame as Buffer;
        // Broadcast to all WS clients
        const msg = Buffer.concat([Buffer.from([1]), lastFrame]);
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
          }
        }
      } catch (e) {
        // Page might be navigating
      }
    }
  };
  captureLoop();
}

// ─── HTTP server ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vm-chrome", clients: clients.size }));
    return;
  }

  if (url.pathname === "/url") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: page?.url() || "" }));
    return;
  }

  if (url.pathname === "/navigate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { url: navUrl } = JSON.parse(body);
        if (navUrl && page) {
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
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

  // Serve the web UI
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_UI);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket server ───
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[vm] WS client connected (${clients.size} total)`);
  if (lastFrame) ws.send(Buffer.concat([Buffer.from([1]), lastFrame]));

  ws.on("message", async (data: Buffer) => {
    if (!page) return;
    try {
      const type = data[0];
      const payloadStr = data.length > 1 ? data.slice(1).toString("utf-8") : "";
      let payload: any = {};
      if (payloadStr) {
        try {
          payload = JSON.parse(payloadStr);
        } catch (e) {}
      }

      // Floor Control Messages
      if (type === 16) {
        // request-control
        const { userId, userName } = payload;
        const res = floorManager.requestControl(userId, userName || "User", ws);
        if (res.status === "granted") {
          const grantMsg = Buffer.concat([
            Buffer.from([128]),
            Buffer.from(JSON.stringify({ controllerId: userId, controllerName: userName })),
          ]);
          ws.send(grantMsg);
        }
        broadcastControlState();
        return;
      } else if (type === 17) {
        // release-control
        const { userId } = payload;
        const res = floorManager.releaseControl(userId);
        if (res.status === "promoted") {
          const grantMsg = Buffer.concat([
            Buffer.from([128]),
            Buffer.from(JSON.stringify({ controllerId: res.nextControllerId, controllerName: res.nextControllerName })),
          ]);
          if (res.nextSocket && res.nextSocket.readyState === WebSocket.OPEN) {
            res.nextSocket.send(grantMsg);
          }
        } else if (res.status === "idle") {
          broadcastGrantControl(null);
        }
        broadcastControlState();
        return;
      } else if (type === 18) {
        // revoke-control
        const { targetUserId } = payload;
        const res = floorManager.revokeControl(targetUserId);
        if (res.status === "promoted") {
          const grantMsg = Buffer.concat([
            Buffer.from([128]),
            Buffer.from(JSON.stringify({ controllerId: res.nextControllerId, controllerName: res.nextControllerName })),
          ]);
          if (res.nextSocket && res.nextSocket.readyState === WebSocket.OPEN) {
            res.nextSocket.send(grantMsg);
          }
        } else if (res.status === "idle") {
          broadcastGrantControl(null);
        }
        broadcastControlState();
        return;
      }

      // Single-Writer Security Invariant: reject input events if not current active controller
      if ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(type)) {
        if (!floorManager.isController(ws)) {
          return;
        }
      }

      if (type === 2) { // Mouse move
        const xNorm = payload.xNorm !== undefined ? payload.xNorm : (payload.x > 1 ? payload.x / WIDTH : payload.x);
        const yNorm = payload.yNorm !== undefined ? payload.yNorm : (payload.y > 1 ? payload.y / HEIGHT : payload.y);
        if (xNorm !== undefined && yNorm !== undefined) {
          const { x, y } = normalizeCoordinates(xNorm, yNorm, WIDTH, HEIGHT);
          await page.mouse.move(x, y);
        }
      } else if (type === 3) { // Mouse click
        const xNorm = payload.xNorm !== undefined ? payload.xNorm : (payload.x > 1 ? payload.x / WIDTH : payload.x);
        const yNorm = payload.yNorm !== undefined ? payload.yNorm : (payload.y > 1 ? payload.y / HEIGHT : payload.y);
        if (xNorm !== undefined && yNorm !== undefined) {
          const { x, y } = normalizeCoordinates(xNorm, yNorm, WIDTH, HEIGHT);
          await page.mouse.click(x, y, { button: payload.button || "left" });
        }
      } else if (type === 4) { // Scroll
        const { deltaX, deltaY } = payload;
        await page.mouse.wheel({ deltaX: deltaX || 0, deltaY: deltaY || 0 });
      } else if (type === 5) { // Key press
        const { key } = payload;
        console.log("[vm] key received:", key, "page exists:", !!page);
        if (key && key.length === 1) {
          await page.keyboard.type(key);
          console.log("[vm] typed:", key);
        } else if (key) {
          await page.keyboard.press(key);
          console.log("[vm] pressed:", key);
        }
      } else if (type === 6) { // Type text
        const { text } = payload;
        if (text) await page.keyboard.type(text);
      } else if (type === 7) { // Navigate
        const { url } = payload;
        if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      } else if (type === 8) { await page.goBack(); }
      else if (type === 9) { await page.goForward(); }
      else if (type === 10) { await page.reload(); }
      else if (type === 11) { // Evaluate JS on page
        const { script } = payload;
        if (script) await page.evaluate(script).catch((e: Error) => console.log("[vm] eval error:", e.message));
      }
    } catch (e) {}
  });

  ws.on("close", () => {
    floorManager.handleDisconnect(ws);
    broadcastControlState();
    clients.delete(ws);
    console.log(`[vm] WS client disconnected (${clients.size} total)`);
  });
});

// ─── Web UI ───
const HTML_UI = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virtual Browser</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; font-family: -apple-system, sans-serif; background: #0a0a0a; }
  body { display: flex; flex-direction: column; }
  #toolbar { display: flex; gap: 4px; padding: 6px 8px; background: #181818; border-bottom: 1px solid #272727; align-items: center; }
  #toolbar button { padding: 6px 10px; border: none; border-radius: 6px; background: #272727; color: #e0e0e0; cursor: pointer; font-size: 13px; }
  #toolbar button:hover { background: #383838; }
  #toolbar input { flex: 1; padding: 6px 12px; border: 1px solid #333; border-radius: 6px; background: #0e0e0e; color: #e0e0e0; font-size: 13px; outline: none; }
  #toolbar input:focus { border-color: #7c3aed; }
  #status { padding: 4px 10px; font-size: 11px; color: #666; }
  #status .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; margin-right: 4px; vertical-align: middle; }
  #stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  #screen { max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; background: #000; }
  #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #555; font-size: 14px; text-align: center; }
  #loading .spinner { width: 32px; height: 32px; border: 3px solid #272727; border-top-color: #7c3aed; border-radius: 50%; margin: 0 auto 12px; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="goBack()">&#8592;</button>
  <button onclick="goFwd()">&#8594;</button>
  <button onclick="reload()">&#10227;</button>
  <input id="urlbar" placeholder="Enter URL..." onkeydown="if(event.key==='Enter')navigate(this.value)" spellcheck="false">
  <button onclick="navigate(document.getElementById('urlbar').value)" style="background:#7c3aed;color:#fff;">Go</button>
</div>
<div id="stage">
  <div id="loading"><div class="spinner"></div>Connecting...</div>
  <canvas id="screen" style="display:none;"></canvas>
</div>
<div id="status"><span class="dot"></span><span id="status-text">1280x720 - 15fps - connecting</span></div>
<script>
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const loading = document.getElementById('loading');
const urlbar = document.getElementById('urlbar');
const statusText = document.getElementById('status-text');
const ws = new WebSocket((location.protocol==='https:'?'wss:':'ws:') + '//' + location.host + '/ws');
ws.binaryType = 'arraybuffer';
let frameCount = 0, lastFpsTime = Date.now(), fps = 0;
ws.onopen = () => { statusText.textContent = '1280x720 - 15fps - connected'; };
ws.onmessage = (e) => {
  const data = new Uint8Array(e.data);
  if (data[0] === 1) {
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
      if (now - lastFpsTime > 1000) { fps = frameCount; frameCount = 0; lastFpsTime = now; statusText.textContent = '1280x720 - ' + fps + 'fps - live'; }
    };
    img.src = url;
  }
};
ws.onclose = () => { loading.style.display = 'block'; loading.innerHTML = '<div class="spinner"></div>Reconnecting...'; canvas.style.display = 'none'; };
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.round((e.clientX - rect.left) * (canvas.width / rect.width)), y: Math.round((e.clientY - rect.top) * (canvas.height / rect.height)) };
}
canvas.addEventListener('mousemove', (e) => { const c = getCoords(e); ws.send(new Uint8Array([2, ...new TextEncoder().encode(JSON.stringify(c))])); });
canvas.addEventListener('mousedown', (e) => { const c = getCoords(e); ws.send(new Uint8Array([3, ...new TextEncoder().encode(JSON.stringify({x:c.x,y:c.y,button:e.button===2?'right':'left'}))])); e.preventDefault(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { ws.send(new Uint8Array([4, ...new TextEncoder().encode(JSON.stringify({deltaX:e.deltaX,deltaY:e.deltaY}))])); e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', (e) => { if (document.activeElement === urlbar) return; ws.send(new Uint8Array([5, ...new TextEncoder().encode(JSON.stringify({key:e.key}))])); if (e.key.length===1||['Backspace','Tab','Enter','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault(); });
function navigate(url) { url=url.trim(); if(!url) return; if(!url.match(/^https?:\\/\\//)) url='https://'+url; urlbar.value=url; ws.send(new Uint8Array([7, ...new TextEncoder().encode(JSON.stringify({url}))])); }
function goBack() { ws.send(new Uint8Array([8])); }
function goFwd() { ws.send(new Uint8Array([9])); }
function reload() { ws.send(new Uint8Array([10])); }
setInterval(() => { if(ws.readyState===1) fetch('/url').then(r=>r.json()).then(d=>{if(d.url&&d.url!==urlbar.value&&document.activeElement!==urlbar)urlbar.value=d.url;}).catch(()=>{}); }, 3000);
</script>
</body>
</html>`;

// ─── Start ───
server.listen(PORT, async () => {
  console.log(`[vm] HTTP server on port ${PORT}`);
  try {
    await launchBrowser();
    console.log(`[vm] Dedicated Chrome ready at http://localhost:${PORT}`);
  } catch (e) {
    console.error("[vm] Failed to launch Chrome:", e);
  }
});

process.on("SIGINT", async () => {
  capturing = false;
  if (browser) await browser.close();
  process.exit(0);
});
