import { NextRequest, NextResponse } from "next/server";
import { generateBookmarkletPage } from "@/lib/sync/bookmarklet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const roomSlug = req.nextUrl.searchParams.get("room") || "your-room-code";
  const html = generateBookmarkletPage(roomSlug);
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
