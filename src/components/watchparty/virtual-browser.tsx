"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Maximize,
  Minimize,
  Globe,
  Lock,
  Unlock,
  Hand,
  Users,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
} from "lucide-react";

interface VirtualBrowserProps {
  vmUrl: string;
  password: string;
  userName: string;
  userColor: string;
  userId: string;
  remoteCursors: Array<{ userId: string; name: string; color: string; x: number; y: number }>;
  controllerId: string | null;
  controlQueue: string[];
  onCursorMove: (x: number, y: number) => void;
  onRequestControl: () => void;
  onReleaseControl: () => void;
}

export function VirtualBrowser({
  vmUrl,
  userName,
  userColor,
  userId,
  remoteCursors,
  controllerId,
  controlQueue,
  onCursorMove,
  onRequestControl,
  onReleaseControl,
}: VirtualBrowserProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fps, setFps] = useState(0);
  const [urlBar, setUrlBar] = useState("");

  const isController = controllerId === userId;
  const wsUrl = vmUrl.replace(/^http/, "ws") + "/ws";

  // Connect to the VM Chrome service via WebSocket
  useEffect(() => {
    let cancelled = false;
    let frameCount = 0;
    let lastFpsTime = Date.now();

    setLoading(true);
    setError(null);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!cancelled) setLoading(false);
    };

    ws.onmessage = (e) => {
      if (cancelled) return;
      const data = new Uint8Array(e.data as ArrayBuffer);
      if (data[0] === 1) {
        // JPEG frame
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const blob = new Blob([data.slice(1)], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== img.width) canvas.width = img.width;
          if (canvas.height !== img.height) canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);

          // FPS counter
          frameCount++;
          const now = Date.now();
          if (now - lastFpsTime > 1000) {
            setFps(frameCount);
            frameCount = 0;
            lastFpsTime = now;
          }
        };
        img.src = url;
      }
    };

    ws.onerror = () => {
      if (!cancelled) {
        setError("Connection error");
        setLoading(false);
      }
    };

    ws.onclose = () => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
        // Auto-reconnect after 2s
        setTimeout(() => {
          if (!cancelled) {
            wsRef.current = null;
            // Trigger reconnect by re-running effect
          }
        }, 2000);
      }
    };

    // Poll URL bar
    const urlInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        fetch(`${vmUrl}/url`)
          .then((r) => r.json())
          .then((d) => {
            if (d.url && d.url !== urlBar) setUrlBar(d.url);
          })
          .catch(() => {});
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(urlInterval);
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // Send mouse position to VM
  const getCoords = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((e.clientY - rect.top) * (canvas.height / rect.height)),
    };
  };

  const sendMsg = (type: number, payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        new Uint8Array([type, ...new TextEncoder().encode(JSON.stringify(payload))]),
      );
    }
  };

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isController) return;
      const c = getCoords(e);
      if (c) {
        sendMsg(2, c);
        // Also broadcast to remote cursors
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          onCursorMove((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
        }
      }
    },
    [isController, onCursorMove],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (!isController) return;
    const c = getCoords(e);
    if (c) sendMsg(3, { ...c, button: e.button === 2 ? "right" : "left" });
    e.preventDefault();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!isController) return;
    sendMsg(4, { deltaX: e.deltaX, deltaY: e.deltaY });
    e.preventDefault();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isController) return;
    if (document.activeElement?.tagName === "INPUT") return;
    sendMsg(5, { key: e.key });
    if (e.key.length === 1 || ["Backspace", "Tab", "Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
    }
  };

  const navigate = (url: string) => {
    url = url.trim();
    if (!url) return;
    if (!url.match(/^https?:\/\//)) url = "https://" + url;
    setUrlBar(url);
    sendMsg(7, { url });
  };

  const goBack = () => sendMsg(8, {});
  const goFwd = () => sendMsg(9, {});
  const reload = () => sendMsg(10, {});
  const goHome = () => navigate("https://www.google.com");

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const queuePosition = (controlQueue || []).indexOf(userId || "");

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5">
        <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        {isController ? (
          <>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400" onClick={goBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400" onClick={goFwd}>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400" onClick={reload}>
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
            <input
              value={urlBar}
              onChange={(e) => setUrlBar(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && navigate(urlBar)}
              placeholder="Enter URL…"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
              spellCheck={false}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400" onClick={goHome}>
              <Home className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <span className="flex-1 truncate text-xs text-zinc-500">
            {controllerId ? "Another user is controlling" : "Shared virtual browser"}
          </span>
        )}

        {/* Control button */}
        {isController ? (
          <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={onReleaseControl}>
            <Unlock className="h-3 w-3" /> Release
          </Button>
        ) : controllerId ? (
          queuePosition >= 0 ? (
            <span className="flex h-7 items-center gap-1 rounded-md bg-zinc-800 px-2 text-xs text-zinc-400">
              <Hand className="h-3 w-3" /> Queue #{queuePosition + 1}
            </span>
          ) : (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onRequestControl}>
              <Hand className="h-3 w-3" /> Request
            </Button>
          )
        ) : (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onRequestControl}>
            <Lock className="h-3 w-3" /> Take control
          </Button>
        )}

        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Canvas + cursor overlay */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 bg-black" tabIndex={0} onKeyDown={onKeyDown}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ pointerEvents: isController ? "auto" : "none", cursor: isController ? "crosshair" : "default" }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Remote cursors overlay */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {remoteCursors
            .filter((c) => c.userId !== userId)
            .map((c) => (
              <div
                key={c.userId}
                className="absolute transition-all duration-75"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, transform: "translate(-2px,-2px)" }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3 2L3 16L7 12L10 18L12 17L9 11L15 11L3 2Z" fill={c.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: c.color }}>
                  {c.name.slice(0, 8)}
                </span>
              </div>
            ))}
          {controllerId && controllerId !== userId && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[10px] text-white/80 backdrop-blur">
              <Users className="mr-1 inline h-3 w-3" />
              {remoteCursors.find((c) => c.userId === controllerId)?.name || "Someone"} is controlling
            </div>
          )}
        </div>

        {/* Loading overlay */}
        {loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            <p className="text-sm text-zinc-400">Connecting to virtual browser…</p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 p-6 text-center">
            <p className="text-sm font-medium text-rose-400">{error}</p>
            <p className="text-xs text-zinc-500">VM service at {vmUrl}</p>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${loading ? "bg-amber-500" : "bg-emerald-500"}`} />
          {loading ? "connecting" : "connected"}
        </span>
        <span className="text-zinc-700">·</span>
        <span>1280×720</span>
        {fps > 0 && (
          <>
            <span className="text-zinc-700">·</span>
            <span>{fps}fps</span>
          </>
        )}
        {isController && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-violet-400">● you control</span>
          </>
        )}
        <span className="ml-auto">{remoteCursors.length + 1} online</span>
      </div>
    </div>
  );
}
