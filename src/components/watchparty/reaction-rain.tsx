"use client";

import { useEffect, useRef, useCallback } from "react";
import { Reaction } from "@/lib/sync/types";

interface ReactionRainProps {
  reactions: Reaction[];
}

interface Particle {
  emoji: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  vr: number;
  color: string;
}

const EMOJI_SIZE = 44;

/**
 * Canvas-based emoji particle physics. Renders floating reactions that
 * drift upward, wobble, and fade — like the confetti on Twitch/Discord.
 */
export function ReactionRain({ reactions }: ReactionRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  const spawnBurst = useCallback((emoji: string, _color: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const count = 6;
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        emoji,
        x: w / 2 + (Math.random() - 0.5) * 80,
        y: h - 20,
        vx: (Math.random() - 0.5) * 4,
        vy: -6 - Math.random() * 4,
        life: 120 + Math.random() * 60,
        maxLife: 180,
        size: EMOJI_SIZE + (Math.random() - 0.5) * 16,
        rotation: (Math.random() - 0.5) * 30,
        vr: (Math.random() - 0.5) * 6,
        color: _color,
      });
    }
  }, []);

  // Spawn new particles when reactions arrive.
  useEffect(() => {
    if (reactions.length === 0) return;
    const latest = reactions[reactions.length - 1];
    spawnBurst(latest.emoji, latest.color);
  }, [reactions, spawnBurst]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.vy += 0.08; // gravity (pulls down, but initial vy is upward)
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        p.life -= 1;
        if (p.life <= 0 || p.y > canvas.offsetHeight + EMOJI_SIZE) {
          ps.splice(i, 1);
          continue;
        }
        const alpha = Math.min(1, p.life / (p.maxLife * 0.4));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.font = `${p.size}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
