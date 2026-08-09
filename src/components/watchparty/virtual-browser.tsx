"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ExternalLink,
  Maximize,
  Minimize,
  Globe,
  Lock,
  Unlock,
  RefreshCw,
  Home,
} from "lucide-react";

interface VirtualBrowserProps {
  /** The VM service URL (e.g. https://vm.kushalneedsmcp.online) */
  vmUrl: string;
  /** Password for the neko session */
  password: string;
  /** Current user name (for display in neko) */
  userName: string;
}

/**
 * VirtualBrowser
 *
 * Embeds a neko virtual browser session in an iframe. Neko provides a
 * full web-based VNC-like interface to a real Chrome running in Docker.
 * Everyone in the room sees the same screen and can take turns controlling.
 *
 * The neko session is shared — all participants connect to the same room
 * with the same password, seeing the same browser screen in real-time.
 */
export function VirtualBrowser({ vmUrl, password, userName }: VirtualBrowserProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [urlBar, setUrlBar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasControl, setHasControl] = useState(false);

  // Build the neko URL with auto-join parameters.
  // Neko supports auto-join via URL: ?password=xxx&name=xxx&control=true
  const nekoSrc = `${vmUrl}/?password=${encodeURIComponent(password)}&name=${encodeURIComponent(userName)}&control=true&audio=true`;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
  }, [nekoSrc]);

  const toggleFullscreen = () => {
    const el = iframeRef.current;
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

  const openInNewTab = () => {
    window.open(nekoSrc, "_blank", "noopener,noreferrer");
  };

  const refresh = () => {
    if (iframeRef.current) {
      const src = iframeRef.current.src;
      iframeRef.current.src = "";
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      }, 200);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {/* URL bar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5">
        <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <Input
          value={urlBar}
          onChange={(e) => setUrlBar(e.target.value)}
          placeholder="Virtual browser — navigate from inside the VM"
          className="h-7 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 placeholder:text-zinc-600"
          readOnly
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          onClick={refresh}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          onClick={toggleFullscreen}
          title="Fullscreen"
        >
          {fullscreen ? (
            <Minimize className="h-3.5 w-3.5" />
          ) : (
            <Maximize className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          onClick={openInNewTab}
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Neko iframe */}
      <div className="relative min-h-0 flex-1 bg-black">
        <iframe
          ref={iframeRef}
          src={nekoSrc}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-read; clipboard-write"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-pointer-lock"
          onLoad={() => setLoading(false)}
          onError={() => setError("Failed to load virtual browser")}
          title="Virtual Browser"
        />

        {/* Loading overlay */}
        {loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            <p className="text-sm text-zinc-400">Starting virtual browser…</p>
            <p className="text-xs text-zinc-600">
              Launching headless Chrome (takes ~5s)
            </p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 p-6 text-center">
            <p className="text-sm font-medium text-rose-400">{error}</p>
            <p className="text-xs text-zinc-500">
              Make sure the VM service is running and{" "}
              <code className="rounded bg-zinc-800 px-1 font-mono">
                {vmUrl}
              </code>{" "}
              is accessible.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={refresh}
              className="mt-2"
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          VM connected
        </span>
        <span className="text-zinc-700">·</span>
        <span>1280×720 @ 30fps</span>
        <span className="text-zinc-700">·</span>
        <span>WebRTC stream</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-5 gap-1 px-1.5 text-[10px] text-zinc-400"
          onClick={() => setHasControl((v) => !v)}
        >
          {hasControl ? (
            <>
              <Lock className="h-2.5 w-2.5" /> You control
            </>
          ) : (
            <>
              <Unlock className="h-2.5 w-2.5" /> Click to control
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
