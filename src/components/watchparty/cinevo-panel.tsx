"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Film,
  Users,
  Zap,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Download,
  ArrowRight,
  Copy,
  Check,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

export interface CineVoPanelProps {
  cinevoUrl: string;
  setCinevoUrl: (v: string) => void;
  onOpen: () => void;
  extInstalled: boolean | null;
  roomSlug: string;
  shareUrl?: string;
  connected: boolean;
  drift: number;
  participants: number;
  sourceUrl?: string;
}

export function CineVoPanel({
  cinevoUrl,
  setCinevoUrl,
  onOpen,
  extInstalled,
  roomSlug,
  shareUrl,
  connected,
  drift,
  participants,
  sourceUrl,
}: CineVoPanelProps) {
  const [copied, setCopied] = useState(false);

  const effectiveShareUrl =
    shareUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/#/room/${roomSlug}`
      : `/#/room/${roomSlug}`);

  const copyRoomLink = () => {
    navigator.clipboard.writeText(effectiveShareUrl).then(() => {
      setCopied(true);
      toast.success("Room link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-br from-background via-background to-violet-950/30">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {/* Header section */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/30">
            <Film className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            CineVo Direct Sync
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Everyone opens the movie on CineVo in their own browser. The WatchParty extension synchronizes the playhead in real-time.
          </p>
        </div>

        {/* Telemetry and room badges */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-3 text-xs">
          <Badge variant={connected ? "default" : "secondary"} className="gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"
              }`}
            />
            {connected ? "Sync engine online" : "Connecting…"}
          </Badge>
          {connected && (
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" /> {Math.abs(Math.round(drift))}ms drift
            </Badge>
          )}
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" /> {participants} watching
          </Badge>
          <button
            onClick={copyRoomLink}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card/60 px-3 py-1 text-xs font-mono font-medium hover:bg-card transition-colors"
          >
            <Link2 className="h-3 w-3 text-violet-400" />
            <span>Room: {roomSlug}</span>
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        </div>

        {/* MV3 Chrome Extension Status Card */}
        <div
          className={`mb-6 rounded-xl border p-4 transition-colors ${
            extInstalled
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          <div className="flex items-start gap-3">
            {extInstalled ? (
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500" />
            ) : extInstalled === null ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                {extInstalled
                  ? "WatchParty Extension Active"
                  : extInstalled === null
                    ? "Detecting Extension…"
                    : "Extension Required"}
              </p>
              {extInstalled ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The extension is installed and ready. When you open CineVo, the floating sync agent will automatically keep you in sync.
                </p>
              ) : (
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <p>To watch movies on CineVo together without server lag:</p>
                  <ol className="list-decimal list-inside space-y-1 text-foreground/80">
                    <li>Download the extension zip file</li>
                    <li>Open <code>chrome://extensions</code> in Chrome / Brave / Edge</li>
                    <li>Enable &ldquo;Developer mode&rdquo; and click &ldquo;Load unpacked&rdquo; (select the <code>extension</code> folder)</li>
                  </ol>
                  <a
                    href="/watchparty-extension.zip"
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground mt-2 shadow-sm hover:opacity-90 transition-opacity"
                  >
                    <Download className="h-3.5 w-3.5" /> Download Extension (.zip)
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CineVo Movie URL input & Open/Sync trigger */}
        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div>
            <label className="text-xs font-semibold text-card-foreground">CineVo Movie URL</label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={cinevoUrl}
                onChange={(e) => setCinevoUrl(e.target.value)}
                placeholder="https://cinevo.nl/movie/..."
                className="text-xs"
              />
              <Button onClick={onOpen} className="gap-1 text-xs">
                Open & Sync <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {sourceUrl && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              <p className="font-semibold text-muted-foreground">Currently Playing in Room:</p>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-primary hover:underline font-mono"
              >
                {sourceUrl}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
