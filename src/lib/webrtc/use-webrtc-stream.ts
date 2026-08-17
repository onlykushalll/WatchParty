"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── WebRTC config ──────────────────────────────────────────────────────────
// Google's public STUN servers work for ~80% of NAT scenarios.
// For symmetric NAT (some corporate/hotel networks), you'd need a TURN server.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

export interface StreamPeer {
  userId: string;
  pc: RTCPeerConnection;
  state: RTCPeerConnectionState;
}

export interface UseWebRTCStreamArgs {
  socket: any; // Socket.IO socket
  userId: string;
  // Host: the <video> element whose stream we're capturing
  sourceVideoRef: React.RefObject<HTMLVideoElement | null>;
  // Viewer: the <video> element where we'll play the received stream
  destVideoRef: React.RefObject<HTMLVideoElement | null>;
  // Whether this client is the stream host
  isHost: boolean;
}

export interface WebRTCStreamState {
  streaming: boolean;
  peers: StreamPeer[];
  error: string | null;
  remoteStream: MediaStream | null;
  fileName: string | null;
}

export function useWebRTCStream({
  socket,
  userId,
  sourceVideoRef,
  destVideoRef,
  isHost,
}: UseWebRTCStreamArgs) {
  const [state, setState] = useState<WebRTCStreamState>({
    streaming: false,
    peers: [],
    error: null,
    remoteStream: null,
    fileName: null,
  });

  const capturedStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const updatePeers = useCallback(() => {
    const peers = Array.from(peersRef.current.entries()).map(([userId, pc]) => ({
      userId,
      pc,
      state: pc.connectionState,
    }));
    setState((s) => ({ ...s, peers }));
  }, []);

  // ── HOST: start capturing the video element's stream ──
  const startStreaming = useCallback((fileName?: string) => {
    const videoEl = sourceVideoRef.current;
    if (!videoEl) {
      setState((s) => ({ ...s, error: "No video element to capture" }));
      return;
    }
    try {
      const stream = (videoEl as any).captureStream
        ? (videoEl as any).captureStream(30)
        : (videoEl as any).mozCaptureStream(30);
      capturedStreamRef.current = stream;
      setState((s) => ({ ...s, streaming: true, fileName: fileName || null }));
      socketRef.current?.emit("stream:announce", { streaming: true, fileName });
    } catch (e) {
      setState((s) => ({ ...s, error: "captureStream failed: " + (e as Error).message }));
    }
  }, [sourceVideoRef]);

  const stopStreaming = useCallback(() => {
    capturedStreamRef.current?.getTracks().forEach((t) => t.stop());
    capturedStreamRef.current = null;
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    setState((s) => ({ ...s, streaming: false, peers: [], fileName: null }));
    socketRef.current?.emit("stream:announce", { streaming: false });
  }, []);

  // ── HOST: create a peer connection for a new viewer ──
  const createHostPeer = useCallback(async (viewerId: string) => {
    if (peersRef.current.has(viewerId)) return;
    const stream = capturedStreamRef.current;
    if (!stream) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("rtc:signal", {
          to: viewerId,
          msg: { ice: event.candidate },
        });
      }
    };
    pc.onconnectionstatechange = () => updatePeers();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("rtc:signal", {
      to: viewerId,
      msg: { sdp: pc.localDescription },
    });

    peersRef.current.set(viewerId, pc);
    updatePeers();
  }, [updatePeers]);

  // ── VIEWER: create a peer connection to receive the host's stream ──
  const createViewerPeer = useCallback(async (hostId: string) => {
    if (peersRef.current.has(hostId)) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      const destVideo = destVideoRef.current;
      if (destVideo) {
        destVideo.srcObject = remoteStream;
        destVideo.play().catch(() => {
          destVideo.muted = true;
          destVideo.play().catch(() => {});
        });
      }
      setState((s) => ({ ...s, remoteStream, streaming: true }));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("rtc:signal", {
          to: hostId,
          msg: { ice: event.candidate },
        });
      }
    };
    pc.onconnectionstatechange = () => updatePeers();

    peersRef.current.set(hostId, pc);
    updatePeers();
  }, [destVideoRef, updatePeers]);

  // ── Handle incoming WebRTC signals ──
  useEffect(() => {
    if (!socket) return;

    const handleSignal = async (data: { from: string; msg: any }) => {
      const { from, msg } = data;
      if (!msg) return;
      let pc = peersRef.current.get(from);

      if (msg.sdp) {
        if (msg.sdp.type === "offer") {
          if (!pc) {
            await createViewerPeer(from);
            pc = peersRef.current.get(from);
          }
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socketRef.current?.emit("rtc:signal", {
              to: from,
              msg: { sdp: pc.localDescription },
            });
          }
        } else if (msg.sdp.type === "answer") {
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          }
        }
      } else if (msg.ice) {
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.ice));
          } catch {}
        }
      }
    };

    const handleStreamAnnounce = (data: { userId: string; streaming: boolean; fileName?: string }) => {
      if (data.userId === userId) return;
      if (data.streaming) {
        if (!isHostRef.current) {
          setState((s) => ({ ...s, fileName: data.fileName || null }));
          createViewerPeer(data.userId);
        }
      } else {
        const pc = peersRef.current.get(data.userId);
        if (pc) {
          pc.close();
          peersRef.current.delete(data.userId);
          updatePeers();
        }
        const destVideo = destVideoRef.current;
        if (destVideo) destVideo.srcObject = null;
        setState((s) => ({ ...s, streaming: false, remoteStream: null, fileName: null }));
      }
    };

    socket.on("rtc:signal", handleSignal);
    socket.on("stream:announce", handleStreamAnnounce);

    return () => {
      socket.off("rtc:signal", handleSignal);
      socket.off("stream:announce", handleStreamAnnounce);
    };
  }, [socket, userId, createViewerPeer, updatePeers, destVideoRef]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      capturedStreamRef.current?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
    };
  }, []);

  return {
    ...state,
    startStreaming,
    stopStreaming,
    createHostPeer,
    createViewerPeer,
  };
}
