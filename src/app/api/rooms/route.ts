import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { name?: string; slug?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const name = (body.name || "Watch Party").toString().slice(0, 80);
  let slug = (body.slug || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!slug) {
    const adj = ["cozy","cosmic","electric","velvet","midnight","lunar","sunny","neon","quiet","wild","golden","crimson","azure","emerald"];
    const noun = ["cinema","den","lounge","theater","studio","dive","cove","hall","room","deck","lair","nest","bay","zone"];
    slug = `${adj[Math.floor(Math.random()*adj.length)]}-${noun[Math.floor(Math.random()*noun.length)]}-${Math.floor(Math.random()*900+100)}`;
  }

  // Ensure uniqueness.
  let attempt = 0;
  while (await db.room.findUnique({ where: { slug } }).catch(() => null)) {
    attempt++;
    slug = `${slug}-${attempt}`;
    if (attempt > 50) { slug = `${slug}-${Date.now().toString(36)}`; break; }
  }

  const hostToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const room = await db.room.create({ data: { slug, name, hostToken } });

  return NextResponse.json({
    id: room.id, slug: room.slug, name: room.name, hostToken: room.hostToken, createdAt: room.createdAt,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "rooms" });
}
