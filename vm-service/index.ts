/**
 * Virtual Browser Service for WatchParty
 * ---------------------------------------
 * Runs on port 3004. Uses puppeteer-core to control the user's Chrome installation,
 * streams screenshots as MJPEG over HTTP, and accepts mouse/keyboard input over WebSocket.
 *
 * Implements M3 requirements:
 * - Server-side mutex floor control queue state machine
 * - Single-writer security invariant for remote input
 * - Remote input unit vector normalization
 * - URL sanitization & CDP frame navigation event pushing
 * - Low-RAM dynamic Chrome launching
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer, { Browser, Page } from "puppeteer-core";

const PORT = 3004;
const DEFAULT_CHROME_PATH =
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/chromium";

const CHROME_PATH = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
const IS_HEADLESS = process.env.HEADLESS !== "false";
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 15; // screenshots per second
const JPEG_QUALITY = 70;

// ─── Exportable Helpers & State Machine for Testing & Core Execution ───

export interface QueuedUser {
  userId: string;
  userName: string;
  socket: WebSocket;
}

export interface ControlState {
  controllerId: string | null;
  controllerName?: string | null;
  queue: Array<{ userId: string; userName: string }>;
}

export class FloorControlManager {
  private state: "IDLE" | "OCCUPIED" = "IDLE";
  private activeControllerId: string | null = null;
  private activeControllerName: string | null = null;
  private activeControllerSocket: WebSocket | null = null;
  private controlQueue: QueuedUser[] = [];

  getState(): "IDLE" | "OCCUPIED" {
    return this.state;
  }

  getActiveControllerId(): string | null {
    return this.activeControllerId;
  }

  getActiveControllerSocket(): WebSocket | null {
    return this.activeControllerSocket;
  }

  getControlState(): ControlState {
    return {
      controllerId: this.activeControllerId,
      controllerName: this.activeControllerName,
      queue: this.controlQueue.map((q) => ({ userId: q.userId, userName: q.userName })),
    };
  }

  isController(socket: WebSocket): boolean {
    return this.state === "OCCUPIED" && this.activeControllerSocket === socket;
  }

  requestControl(userId: string, userName: string, socket: WebSocket) {
    if (this.state === "IDLE") {
      this.state = "OCCUPIED";
      this.activeControllerId = userId;
      this.activeControllerName = userName;
      this.activeControllerSocket = socket;
      return { status: "granted", controllerId: userId, controllerName: userName };
    } else {
      if (this.activeControllerId === userId) {
        this.activeControllerSocket = socket;
        return { status: "already_controller", controllerId: userId };
      }
      const existingIdx = this.controlQueue.findIndex((q) => q.userId === userId);
      if (existingIdx >= 0) {
        this.controlQueue[existingIdx].socket = socket;
        this.controlQueue[existingIdx].userName = userName;
        return { status: "queued", position: existingIdx + 1 };
      }
      this.controlQueue.push({ userId, userName, socket });
      return { status: "queued", position: this.controlQueue.length };
    }
  }

  releaseControl(userId: string, requestingSocket?: WebSocket) {
    if (this.activeControllerId === userId) {
      if (requestingSocket && this.activeControllerSocket !== requestingSocket) {
        return { status: "unauthorized" };
      }
      if (this.controlQueue.length > 0) {
        const next = this.controlQueue.shift()!;
        this.activeControllerId = next.userId;
        this.activeControllerName = next.userName;
        this.activeControllerSocket = next.socket;
        return {
          status: "promoted",
          nextControllerId: next.userId,
          nextControllerName: next.userName,
          nextSocket: next.socket,
        };
      } else {
        this.state = "IDLE";
        this.activeControllerId = null;
        this.activeControllerName = null;
        this.activeControllerSocket = null;
        return { status: "idle" };
      }
    } else {
      const queuedItem = this.controlQueue.find((q) => q.userId === userId);
      if (queuedItem) {
        if (requestingSocket && queuedItem.socket !== requestingSocket) {
          return { status: "unauthorized" };
        }
        this.controlQueue = this.controlQueue.filter((q) => q.userId !== userId);
        return { status: "removed_from_queue" };
      }
      return { status: "not_found" };
    }
  }

  revokeControl(targetUserId: string) {
    if (this.activeControllerId === targetUserId) {
      return this.releaseControl(targetUserId);
    } else {
      this.controlQueue = this.controlQueue.filter((q) => q.userId !== targetUserId);
      return { status: "revoked_from_queue" };
    }
  }

  handleDisconnect(socket: WebSocket) {
    if (this.activeControllerSocket === socket) {
      return this.releaseControl(this.activeControllerId!);
    } else {
      this.controlQueue = this.controlQueue.filter((q) => q.socket !== socket);
      return { status: "queue_updated" };
    }
  }
}

export function sanitizeUnit(v: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function normalizeCoordinates(
  xNorm: number,
  yNorm: number,
  width: number = WIDTH,
  height: number = HEIGHT
): { x: number; y: number } {
  const clampedX = sanitizeUnit(xNorm);
  const clampedY = sanitizeUnit(yNorm);
  const x = Math.min(width - 1, Math.max(0, Math.floor(clampedX * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(clampedY * height)));
  return { x, y };
}

export function sanitizeUrl(inputUrl: string): string {
  const trimmed = (inputUrl || "").trim();
  if (!trimmed) {
    throw new Error("URL string cannot be empty");
  }

  const lower = trimmed.toLowerCase();
  const forbiddenSchemes = ["file:", "chrome:", "chrome-extension:", "javascript:", "data:", "about:"];
  for (const scheme of forbiddenSchemes) {
    if (lower.startsWith(scheme)) {
      throw new Error(`Forbidden URL scheme: ${scheme}`);
    }
  }

  let formatted = trimmed;
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = `https://${formatted}`;
  }

  try {
    const parsed = new URL(formatted);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS protocols are allowed");
    }
    return parsed.toString();
  } catch (err) {
    throw new Error(`Invalid URL format: ${(err as Error).message}`);
  }
}

// ─── Service State ───
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
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastGrantControl(controllerId: string | null, controllerName?: string | null) {
  const msg = Buffer.concat([
    Buffer.from([128]),
    Buffer.from(JSON.stringify({ controllerId, controllerName })),
  ]);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastUrl(currentUrl: string) {
  const msg = Buffer.concat([
    Buffer.from([12]), // Type 12 (0x0C): Push URL change
    Buffer.from(JSON.stringify({ url: currentUrl })),
  ]);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ─── Browser Launch ───
async function launchBrowser() {
  console.log(`[vm] Launching Chrome via executable: ${CHROME_PATH} (Headless: ${IS_HEADLESS})…`);
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: IS_HEADLESS ? ("shell" as any) : false,
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--renderer-process-limit=2",
      '--js-flags="--max-old-space-size=512"',
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

  // CDP frame navigation push listener
  page.on("framenavigated", (frame) => {
    if (page && frame === page.mainFrame()) {
      broadcastUrl(page.url());
    }
  });

  // Stealth: avoid headless detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  }).catch(() => {});

  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("[vm] Chrome launched, starting capture loop");

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
        const msg = Buffer.concat([Buffer.from([1]), lastFrame]);
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
          }
        }
      } catch (e) {
        // Page might be navigating
      }
      await new Promise((r) => setTimeout(r, 1000 / FPS));
    }
  };
  captureLoop();
}

// ─── HTTP Server ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vm-browser", clients: clients.size }));
    return;
  }

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

  if (url.pathname === "/url") {
    const currentUrl = page?.url() || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: currentUrl }));
    return;
  }

  if (url.pathname === "/navigate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { url: navUrl } = JSON.parse(body);
        if (navUrl && page) {
          const validUrl = sanitizeUrl(navUrl);
          await page.goto(validUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, url: page.url() }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "Missing url" }));
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: String((e as Error).message || e) }));
      }
    });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_UI);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket Server ───
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[vm] WS client connected (${clients.size} total)`);

  if (lastFrame) {
    ws.send(Buffer.concat([Buffer.from([1]), lastFrame]));
  }

  // Send current floor state upon connection
  const currentState = floorManager.getControlState();
  ws.send(Buffer.concat([Buffer.from([129]), Buffer.from(JSON.stringify(currentState))]));

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
        const res = floorManager.releaseControl(userId, ws);
        if (res.status === "unauthorized") {
          return;
        }
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
          // Reject unauthorized input event frame
          return;
        }
      }

      if (type === 2) {
        // Mouse move
        const xNorm = payload.xNorm !== undefined ? payload.xNorm : payload.x;
        const yNorm = payload.yNorm !== undefined ? payload.yNorm : payload.y;
        if (xNorm !== undefined && yNorm !== undefined) {
          const { x, y } = normalizeCoordinates(xNorm, yNorm, WIDTH, HEIGHT);
          await page.mouse.move(x, y);
        }
      } else if (type === 3) {
        // Mouse click
        const xNorm = payload.xNorm !== undefined ? payload.xNorm : payload.x;
        const yNorm = payload.yNorm !== undefined ? payload.yNorm : payload.y;
        if (xNorm !== undefined && yNorm !== undefined) {
          const { x, y } = normalizeCoordinates(xNorm, yNorm, WIDTH, HEIGHT);
          await page.mouse.click(x, y, { button: payload.button || "left" });
        }
      } else if (type === 4) {
        // Mouse scroll
        const { deltaX, deltaY } = payload;
        await page.mouse.wheel({ deltaX: deltaX || 0, deltaY: deltaY || 0 });
      } else if (type === 5) {
        // Keyboard keydown
        const { key } = payload;
        await page.keyboard.press(key);
      } else if (type === 6) {
        // Type text
        const { text } = payload;
        await page.keyboard.type(text);
      } else if (type === 7) {
        // Navigate
        const { url } = payload;
        const validUrl = sanitizeUrl(url);
        await page.goto(validUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      } else if (type === 8) {
        await page.goBack();
      } else if (type === 9) {
        await page.goForward();
      } else if (type === 10) {
        await page.reload();
      } else if (type === 11) {
        const { script } = payload;
        await page.evaluate(script).catch(() => {});
      }
    } catch (e) {
      // Ignore input errors
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[vm] WS client disconnected (${clients.size} total)`);
    const res = floorManager.handleDisconnect(ws);
    if (res?.status === "promoted") {
      const grantMsg = Buffer.concat([
        Buffer.from([128]),
        Buffer.from(JSON.stringify({ controllerId: res.nextControllerId, controllerName: res.nextControllerName })),
      ]);
      if (res.nextSocket && res.nextSocket.readyState === WebSocket.OPEN) {
        res.nextSocket.send(grantMsg);
      }
    } else if (res?.status === "idle") {
      broadcastGrantControl(null);
    }
    broadcastControlState();
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
  } else if (data[0] === 12) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(data.slice(1)));
      if (payload.url && payload.url !== urlbar.value && document.activeElement !== urlbar) {
        urlbar.value = payload.url;
      }
    } catch (err) {}
  }
};

ws.onclose = () => { loading.style.display = 'block'; loading.innerHTML = '<div class="spinner"></div>Reconnecting…'; canvas.style.display = 'none'; statusText.textContent = 'disconnected'; };
ws.onerror = () => { loading.innerHTML = '<div class="spinner"></div>Connection error'; };

function getNormalizedCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  return { xNorm, yNorm };
}

canvas.addEventListener('mousemove', (e) => {
  const { xNorm, yNorm } = getNormalizedCoords(e);
  ws.send(new Uint8Array([2, ...new TextEncoder().encode(JSON.stringify({xNorm, yNorm}))]));
});
canvas.addEventListener('mousedown', (e) => {
  const { xNorm, yNorm } = getNormalizedCoords(e);
  const btn = e.button === 2 ? 'right' : 'left';
  ws.send(new Uint8Array([3, ...new TextEncoder().encode(JSON.stringify({xNorm, yNorm, button: btn}))]));
  e.preventDefault();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  ws.send(new Uint8Array([4, ...new TextEncoder().encode(JSON.stringify({deltaX: e.deltaX, deltaY: e.deltaY}))]));
  e.preventDefault();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (document.activeElement === urlbar) return;
  ws.send(new Uint8Array([5, ...new TextEncoder().encode(JSON.stringify({key: e.key}))]));
  if (e.key.length === 1 || ['Backspace','Tab','Enter','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});

function navigate(url) {
  url = (url || '').trim();
  if (!url) return;
  if (!url.match(/^https?:\\/\\//)) url = 'https://' + url;
  urlbar.value = url;
  ws.send(new Uint8Array([7, ...new TextEncoder().encode(JSON.stringify({url}))]));
}
function goBack() { ws.send(new Uint8Array([8])); }
function goFwd() { ws.send(new Uint8Array([9])); }
function reload() { ws.send(new Uint8Array([10])); }
function goHome() { navigate('https://www.google.com'); }
</script>
</body>
</html>`;

// ─── Start Server (Only if not in test environment and run as main entry point) ───
if (process.env.NODE_ENV !== "test" && process.argv[1] && (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))) {
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
}

process.on("SIGINT", async () => {
  capturing = false;
  if (browser) await browser.close();
  process.exit(0);
});

