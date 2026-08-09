"use client";

import { Participant } from "@/lib/sync/types";
import { Crown, Gamepad2, Mic, MicOff, Video, VideoOff, Radio } from "lucide-react";

interface ParticipantsListProps {
  participants: Participant[];
  youId: string;
  vmController?: string | null;
}

export function ParticipantsList({
  participants,
  youId,
  vmController,
}: ParticipantsListProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {participants.map((p) => {
        const isYou = p.userId === youId;
        const isFloorController = vmController ? p.userId === vmController : false;
        const isMicMuted = p.isMicMuted ?? true;
        const isCameraOn = p.isCameraOn ?? false;

        return (
          <div
            key={p.userId}
            className="group relative flex items-center gap-1.5 rounded-full border bg-card/60 px-2 py-1 text-xs shadow-sm transition-all hover:bg-card"
            title={`${p.name}${isYou ? " (you)" : ""}${p.isHost ? " · Host 👑" : ""}${isFloorController ? " · Floor Controller 🎮" : ""}`}
          >
            {/* User Avatar Circle */}
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm"
              style={{ backgroundColor: p.color }}
            >
              {p.name.slice(0, 2).toUpperCase()}
            </div>

            {/* Name */}
            <span className="max-w-[80px] truncate text-[11px] font-medium">
              {isYou ? "you" : p.name}
            </span>

            {/* Host Crown Indicator */}
            {p.isHost && (
              <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            )}

            {/* VM Floor Controller Badge */}
            {isFloorController && (
              <Gamepad2 className="h-3.5 w-3.5 shrink-0 text-cyan-400 animate-pulse" />
            )}

            {/* Mic Status Icon */}
            {!isMicMuted ? (
              <Mic className="h-3 w-3 shrink-0 text-emerald-400" />
            ) : (
              <MicOff className="h-3 w-3 shrink-0 text-rose-400/60" />
            )}

            {/* Camera Status Icon */}
            {isCameraOn ? (
              <Video className="h-3 w-3 shrink-0 text-emerald-400" />
            ) : (
              <VideoOff className="h-3 w-3 shrink-0 text-zinc-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SyncIndicator({
  connected,
  rtt,
  drift,
}: {
  connected: boolean;
  rtt: number;
  drift: number;
}) {
  const quality =
    !connected ? "off" : rtt < 100 ? "excellent" : rtt < 300 ? "good" : "poor";
  const color =
    quality === "off"
      ? "bg-zinc-500"
      : quality === "excellent"
        ? "bg-emerald-500"
        : quality === "good"
          ? "bg-amber-500"
          : "bg-rose-500";
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border bg-card/50 px-2.5 py-1 text-[10px]"
      title={`Connection: ${quality}\nRTT: ${rtt}ms\nClock offset: ${Math.round(drift)}ms`}
    >
      <Radio className={`h-3 w-3 ${color.replace("bg-", "text-")}`} />
      <span className="text-muted-foreground font-mono">
        {connected ? `${Math.round(rtt)}ms` : "offline"}
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
    </div>
  );
}
