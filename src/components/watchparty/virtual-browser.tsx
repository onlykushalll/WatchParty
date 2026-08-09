"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Maximize,
  Minimize,
  Globe,
  Lock,
  Unlock,
  Hand,
  Users,
} from "lucide-react";

// Load noVNC RFB from CDN via ES module script tag.
// @novnc/novnc 1.7.0 has core/rfb.js as an ES module with `export default`.
// We load it via a module script and capture the RFB class via a global hook.
let rfbPromise: Promise<any> | null = null;
async function getRFB(): Promise<any> {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (w.__RFB) return w.__RFB;
  if (!rfbPromise) {
    rfbPromise = new Promise((resolve, reject) => {
      const hook = "__novnc_rfb_load_" + Date.now();
      w[hook] = (RFB: any) => {
        w.__RFB = RFB;
        delete w[hook];
        resolve(RFB);
      };
      const s = document.createElement("script");
      s.type = "module";
      s.textContent = 'import RFB from "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.7.0/core/rfb.js"; window.' + hook + '(RFB);';
      s.onerror = () => reject(new Error("Failed to load noVNC module"));
      document.head.appendChild(s);
      setTimeout(() => {
        reject(new Error("noVNC load timeout (15s)"));
        delete w[hook];
      }, 15000);
    });
  }
  return rfbPromise;
}

interface VirtualBrowserProps {
  vmUrl: string;
  password: string;
  userName: string;
  userColor: string;
  userId: string;
  // Cursor + control from sync engine
  remoteCursors: Array<{ userId: string; name: string; color: string; x: number; y: number }>;
  controllerId: string | null;
  controlQueue: string[];
  onCursorMove: (x: number, y: number) => void;
  onRequestControl: () => void;
  onReleaseControl: () => void;
}

export function VirtualBrowser({
  vmUrl,
  password,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hasControl, setHasControl] = useState(false);

  const isController = controllerId === userId;
  const wsUrl = vmUrl.replace(/^http/, "ws") + "/websockify";

  // Initialize noVNC RFB connection
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const RFB = await getRFB();

        if (cancelled || !containerRef.current) return;

        // Clear previous connection
        if (rfbRef.current) {
          rfbRef.current.disconnect();
          rfbRef.current = null;
        }

        const rfb = new RFB(
          containerRef.current,
          wsUrl,
          {
            credentials: { password },
            wsProtocols: ["binary"],
          },
        ) as RFB;

        rfbRef.current = rfb;

        // Configure RFB — noVNC 1.7.0 uses property assignment, not set_* methods
        rfb.scaleViewport = true;
        rfb.showDotCursor = false;
        rfb.resizeSession = true;

        // Event listeners
        const onConnect = () => {
          if (!cancelled) {
            setLoading(false);
            setError(null);
          }
        };

        const onDisconnect = (e: { detail: { clean: boolean } }) => {
          if (!cancelled) {
            if (e.detail.clean) {
              setLoading(true);
            } else {
              setError("Connection lost. Reconnecting…");
              setLoading(true);
            }
          }
        };

        const onCredentialsRequired = () => {
          rfb.sendCredentials({ password });
        };

        const onSecurityFailure = (e: { detail: { status: string; reason: string } }) => {
          if (!cancelled) {
            setError(`Authentication failed: ${e.detail.reason}`);
            setLoading(false);
          }
        };

        // noVNC uses custom events
        rfb.addEventListener("connect", onConnect);
        rfb.addEventListener("disconnect", onDisconnect);
        rfb.addEventListener("credentialsrequired", onCredentialsRequired);
        rfb.addEventListener("securityfailure", onSecurityFailure);

        // Store cleanup
        (rfb as any).__cleanup = () => {
          rfb.removeEventListener("connect", onConnect);
          rfb.removeEventListener("disconnect", onDisconnect);
          rfb.removeEventListener("credentialsrequired", onCredentialsRequired);
          rfb.removeEventListener("securityfailure", onSecurityFailure);
        };
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load noVNC: ${e instanceof Error ? e.message : String(e)}`);
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rfbRef.current) {
        try {
          (rfbRef.current as any).__cleanup?.();
          rfbRef.current.disconnect();
        } catch {}
        rfbRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, password]);

  // Update control state
  useEffect(() => {
    setHasControl(isController);
    if (isController && rfbRef.current) {
      rfbRef.current.focus();
    } else if (rfbRef.current) {
      rfbRef.current.blur();
    }
  }, [isController]);

  // Track local mouse position for cursor broadcast
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        onCursorMove(x, y);
      }
    },
    [onCursorMove],
  );

  const toggleFullscreen = () => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
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
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5">
        <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="flex-1 truncate text-xs text-zinc-400">
          {hasControl ? "You control — click inside to interact" : controllerId ? "Another user is controlling" : "Shared virtual browser"}
        </span>

        {/* Control button */}
        {hasControl ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 gap-1 text-xs"
            onClick={onReleaseControl}
          >
            <Unlock className="h-3 w-3" /> Release
          </Button>
        ) : controllerId ? (
          queuePosition >= 0 ? (
            <Badge variant="secondary" className="h-7 gap-1 text-xs">
              <Hand className="h-3 w-3" /> Queue #{queuePosition + 1}
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={onRequestControl}
            >
              <Hand className="h-3 w-3" /> Request control
            </Button>
          )
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={onRequestControl}
          >
            <Lock className="h-3 w-3" /> Take control
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* noVNC canvas + cursor overlay */}
      <div className="relative min-h-0 flex-1 bg-black">
        {/* noVNC renders into this div */}
        <div
          ref={containerRef}
          className="absolute inset-0"
          onMouseMove={onMouseMove}
          style={{
            pointerEvents: hasControl ? "auto" : "none",
          }}
        />

        {/* Cursor overlay (pointer-events: none, always visible) */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* Remote cursors */}
          {remoteCursors
            .filter((c) => c.userId !== userId)
            .map((c) => (
              <div
                key={c.userId}
                className="absolute flex items-center gap-1 transition-all duration-75"
                style={{
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  transform: "translate(-2px, -2px)",
                }}
              >
                {/* Cursor pointer SVG */}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M3 2L3 16L7 12L10 18L12 17L9 11L15 11L3 2Z"
                    fill={c.color}
                    stroke="white"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
                {/* Name label */}
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white shadow-md"
                  style={{ backgroundColor: c.color }}
                >
                  {c.name.slice(0, 8)}
                </span>
              </div>
            ))}

          {/* Controller indicator */}
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
            <p className="text-xs text-zinc-600">VNC via WebSocket · noVNC client</p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 p-6 text-center">
            <p className="text-sm font-medium text-rose-400">{error}</p>
            <p className="text-xs text-zinc-500">
              Make sure the VNC server is running and accessible at{" "}
              <code className="rounded bg-zinc-800 px-1 font-mono">{vmUrl}</code>
            </p>
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
        <span>1920×1080</span>
        <span className="text-zinc-700">·</span>
        <span>VNC over WebSocket</span>
        {hasControl && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-violet-400">● you control</span>
          </>
        )}
        <span className="ml-auto">
          {remoteCursors.length + 1} {remoteCursors.length + 1 === 1 ? "user" : "users"} online
        </span>
      </div>
    </div>
  );
}
