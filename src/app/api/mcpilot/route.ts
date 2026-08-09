import { NextRequest, NextResponse } from "next/server";
import { callMcpilotTool } from "@/lib/mcpilot";
import { TOOLS_BY_NAME } from "@/lib/mcpilot-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CallBody {
  tool?: string;
  args?: Record<string, unknown>;
}

/**
 * POST /api/mcpilot
 * Body: { tool: string, args?: Record<string, unknown> }
 *
 * Server-side proxy. Talks to MCPilot via fetch only (never curl/bash).
 */
export async function POST(req: NextRequest) {
  let body: CallBody;
  try {
    body = (await req.json()) as CallBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const tool = body.tool;
  const args = body.args ?? {};

  if (!tool || typeof tool !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing 'tool' field" },
      { status: 400 },
    );
  }

  const def = TOOLS_BY_NAME[tool];
  if (!def) {
    return NextResponse.json(
      { ok: false, error: `Unknown tool: ${tool}` },
      { status: 404 },
    );
  }

  // Coerce args: drop empty strings so MCPilot uses its own defaults,
  // and convert "lines of text" -> arrays where the schema wants string[].
  const cleaned: Record<string, unknown> = {};
  for (const p of def.params) {
    const v = args[p.name];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (p.type === "number") {
      const n = Number(v);
      cleaned[p.name] = Number.isNaN(n) ? v : n;
    } else if (p.type === "boolean") {
      cleaned[p.name] = v === true || v === "true" || v === 1 || v === "1";
    } else if (p.type === "string[]") {
      cleaned[p.name] = String(v)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      cleaned[p.name] = v;
    }
  }

  // For read_files, split multiline `paths` into an array.
  if (def.name === "read_files" && typeof cleaned.paths === "string") {
    cleaned.paths = String(cleaned.paths)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const result = await callMcpilotTool(def.name, cleaned, {
    timeoutMs: 180_000,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      isError: result.isError,
      content: result.content,
      parsed: result.parsed,
      durationMs: result.durationMs,
      status: result.status,
      tool: def.name,
      args: cleaned,
      error: result.error,
    },
    { status: result.status >= 200 && result.status < 300 ? 200 : 502 },
  );
}

/**
 * GET /api/mcpilot — quick status probe.
 */
export async function GET() {
  const r = await callMcpilotTool("ping", {});
  return NextResponse.json({ ok: r.ok, content: r.content, durationMs: r.durationMs });
}
