"use client";

import { Participant } from "@/lib/sync/types";
import { Crown, Radio } from "lucide-react";

interface ParticipantsListProps {
  participants: Participant[];
  youId: string;
}

export function ParticipantsList({
  participants,
  youId,
}: ParticipantsListProps) {
  return (
    <div className="flex items-center gap-1.5">
      {participants.map((p) => {
        const isYou = p.userId === youId;
        return (
          <div
            key={p.userId}
            className="group relative flex items-center gap-1.5 rounded-full border bg-card/50 py-1 pl-1 pr-2 text-xs"
            title={`${p.name}${isYou ? " (you)" : ""}${p.isHost ? " · host" : ""}`}
          >
            <div
              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: p.color }}
            >
              {p.name.slice(0, 2).toUpperCase()}
            </div>
            <span className="max-w-[80px] truncate text-[11px]">
              {isYou ? "you" : p.name}
            </span>
            {p.isHost && <Crown className="h-3 w-3 text-amber-400" />}
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
      className="flex items-center gap-1.5 rounded-full border bg-card/50 px-2 py-1 text-[10px]"
      title={`Connection: ${quality}\nRTT: ${rtt}ms\nClock offset: ${Math.round(drift)}ms`}
    >
      <Radio className={`h-3 w-3 ${color.replace("bg-", "text-")}`} />
      <span className="text-muted-foreground">
        {connected ? `${Math.round(rtt)}ms` : "offline"}
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
    </div>
  );
}
