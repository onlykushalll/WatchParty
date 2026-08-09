"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Participant } from "@/lib/sync/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Crown,
  Gamepad2,
  Eye,
  EyeOff,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

interface CallsPanelProps {
  participants: Participant[];
  youId: string;
  youName: string;
  youColor: string;
  vmController?: string | null;
  onUpdateMediaState: (state: Partial<{
    isMicMuted: boolean;
    isCameraOn: boolean;
    cameraPrivacyMode: "blackout" | "blur" | "avatar";
  }>) => void;
}

export function CallsPanel({
  participants,
  youId,
  youName,
  youColor,
  vmController,
  onUpdateMediaState,
}: CallsPanelProps) {
  const [optedIn, setOptedIn] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [privacyMode, setPrivacyMode] = useState<"blackout" | "blur" | "avatar">("avatar");
  const [stream, setStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Stop media tracks when component unmounts or opt-out
  const stopTracks = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }, [stream]);

  // Request getUserMedia on explicit opt-in
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setStream(mediaStream);
      setOptedIn(true);
      setIsCameraOn(true);
      setIsMicMuted(false);
      onUpdateMediaState({
        isMicMuted: false,
        isCameraOn: true,
        cameraPrivacyMode: privacyMode,
      });
      toast.success("Webcam & Mic activated (Opt-In)");
    } catch (err) {
      console.warn("getUserMedia failed or denied:", err);
      // Fallback: Enable call UI in synthetic mode without physical camera access
      setOptedIn(true);
      setIsCameraOn(false);
      setIsMicMuted(true);
      onUpdateMediaState({
        isMicMuted: true,
        isCameraOn: false,
        cameraPrivacyMode: privacyMode,
      });
      toast.info("Webcam active in Privacy Avatar mode");
    }
  };

  const stopCall = () => {
    stopTracks();
    setOptedIn(false);
    setIsCameraOn(false);
    setIsMicMuted(true);
    onUpdateMediaState({
      isMicMuted: true,
      isCameraOn: false,
      cameraPrivacyMode: privacyMode,
    });
    toast.info("Left video call");
  };

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
    }
  }, [stream, optedIn, isCameraOn]);

  // Toggle mic track
  const toggleMic = () => {
    const nextMuted = !isMicMuted;
    setIsMicMuted(nextMuted);
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }
    onUpdateMediaState({ isMicMuted: nextMuted });
    toast.info(nextMuted ? "Microphone muted" : "Microphone unmuted");
  };

  // Toggle camera track
  const toggleCamera = () => {
    const nextCam = !isCameraOn;
    setIsCameraOn(nextCam);
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = nextCam;
      });
    }
    onUpdateMediaState({ isCameraOn: nextCam });
    toast.info(nextCam ? "Camera turned on" : "Camera turned off");
  };

  // Change privacy mode
  const changePrivacyMode = (mode: "blackout" | "blur" | "avatar") => {
    setPrivacyMode(mode);
    onUpdateMediaState({ cameraPrivacyMode: mode });
    toast.info(`Privacy mode set to ${mode.toUpperCase()}`);
  };

  // Cleanup tracks on unmount
  useEffect(() => {
    return () => {
      stopTracks();
    };
  }, [stopTracks]);

  if (!optedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 p-6 text-center bg-card/20">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-500 shadow-md">
          <VideoOff className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Webcam & Voice Call</h3>
          <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
            Zero-camera opt-in privacy guarantee. Your webcam and mic are completely off until you join.
          </p>
        </div>
        <Button
          size="sm"
          className="mt-2 gap-2 bg-violet-600 hover:bg-violet-700 text-white font-medium shadow-md"
          onClick={startCamera}
        >
          <Video className="h-4 w-4" /> Enable Camera & Mic
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-2 bg-background">
      {/* Header controls & Privacy Selector */}
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-400 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
            Live Call
          </Badge>
        </div>

        {/* Privacy Mode Selector */}
        <div className="flex rounded-md border bg-muted/50 p-0.5 text-[10px]">
          {(["avatar", "blur", "blackout"] as const).map((m) => (
            <button
              key={m}
              onClick={() => changePrivacyMode(m)}
              className={`rounded px-2 py-0.5 font-medium transition-all ${
                privacyMode === m
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Participant Video Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 gap-2.5">
        {participants.map((p) => {
          const isYou = p.userId === youId;
          const isFloorController = vmController ? p.userId === vmController : false;
          const participantCamOn = isYou ? isCameraOn : (p.isCameraOn ?? false);
          const participantMicMuted = isYou ? isMicMuted : (p.isMicMuted ?? true);
          const pPrivacyMode = isYou ? privacyMode : (p.cameraPrivacyMode || "avatar");

          return (
            <div
              key={p.userId}
              className="relative aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-md group"
            >
              {/* Actual Video Stream for Local User if camera is ON */}
              {isYou && stream && participantCamOn ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`h-full w-full object-cover ${
                    pPrivacyMode === "blur" ? "filter blur-md" : ""
                  }`}
                />
              ) : participantCamOn ? (
                /* Remote active camera placeholder */
                <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400 text-xs font-medium">
                  <Video className="mr-1.5 h-4 w-4 text-emerald-400" /> Remote Video Active
                </div>
              ) : (
                /* Privacy Mute Overlay (Avatar / Blur / Blackout) */
                <div className="relative flex h-full w-full items-center justify-center bg-zinc-950">
                  {pPrivacyMode === "blackout" && (
                    <div className="flex flex-col items-center justify-center gap-1 text-zinc-600">
                      <EyeOff className="h-6 w-6" />
                      <span className="text-[10px]">Camera Blackout</span>
                    </div>
                  )}

                  {pPrivacyMode === "blur" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-violet-950/20 backdrop-blur-xl">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-full text-base font-bold text-white shadow-lg filter blur-[1px]"
                          style={{ backgroundColor: p.color }}
                        >
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-medium">Blurred Backdrop</span>
                      </div>
                    </div>
                  )}

                  {pPrivacyMode === "avatar" && (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div
                        className="relative flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white shadow-lg"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.name.slice(0, 2).toUpperCase()}
                        {!participantMicMuted && (
                          <span className="absolute -inset-1 rounded-full border-2 border-emerald-400 animate-ping opacity-75" />
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-400 font-medium">
                        {p.name} {isYou ? "(You)" : ""}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Status Badges Overlay */}
              <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-[10px] text-white backdrop-blur">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="font-semibold truncate max-w-[90px]">
                  {isYou ? `${p.name} (You)` : p.name}
                </span>
                {p.isHost && <Crown className="h-3 w-3 text-amber-400" />}
                {isFloorController && <Gamepad2 className="h-3 w-3 text-cyan-400" />}
              </div>

              {/* Mic & Camera Status Corner Icons */}
              <div className="absolute right-2 bottom-2 z-10 flex items-center gap-1">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm ${
                    participantMicMuted ? "bg-rose-500/80" : "bg-emerald-500/80"
                  }`}
                >
                  {!participantMicMuted ? (
                    <Mic className="h-3 w-3" />
                  ) : (
                    <MicOff className="h-3 w-3" />
                  )}
                </span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm ${
                    participantCamOn ? "bg-emerald-500/80" : "bg-zinc-700/80"
                  }`}
                >
                  {participantCamOn ? (
                    <Video className="h-3 w-3" />
                  ) : (
                    <VideoOff className="h-3 w-3" />
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Call Action Bar */}
      <div className="flex items-center justify-center gap-2 border-t pt-2">
        <Button
          size="icon"
          variant={isMicMuted ? "destructive" : "secondary"}
          className="h-9 w-9 rounded-full"
          onClick={toggleMic}
          title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
        >
          {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>

        <Button
          size="icon"
          variant={!isCameraOn ? "destructive" : "secondary"}
          className="h-9 w-9 rounded-full"
          onClick={toggleCamera}
          title={isCameraOn ? "Turn Off Camera" : "Turn On Camera"}
        >
          {!isCameraOn ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-9 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs px-3"
          onClick={stopCall}
        >
          Leave Call
        </Button>
      </div>
    </div>
  );
}
