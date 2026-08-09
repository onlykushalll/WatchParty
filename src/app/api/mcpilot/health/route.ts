import { NextResponse } from "next/server";
import { getMcpilotHealth } from "@/lib/mcpilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mcpilot/health — proxy to MCPilot /health (fetch only).
 */
export async function GET() {
  const { health, status, error } = await getMcpilotHealth();
  return NextResponse.json(
    { health, status, error, baseUrl: process.env.MCPILOT_BASE_URL },
    { status: status >= 200 && status < 300 ? 200 : 502 },
  );
}
