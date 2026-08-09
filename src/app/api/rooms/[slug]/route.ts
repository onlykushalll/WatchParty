import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const room = await db.room.findUnique({ where: { slug } });
  if (!room) {
    return NextResponse.json({ ok: false, error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: room.id,
    slug: room.slug,
    name: room.name,
    createdAt: room.createdAt,
  });
}
