/**
 * MCPilot server-side client.
 *
 * IMPORTANT: This module talks to MCPilot exclusively via the JavaScript
 * `fetch` API (never curl / never bash HTTP), per project policy.
 *
 * Used by Next.js route handlers (server-side only). The token is read
 * from environment variables and is never exposed to the browser.
 */

export const MCPILOT_BASE_URL =
  process.env.MCPILOT_BASE_URL || "https://kushalneedsmcp.online";
export const MCPILOT_TOKEN =
  process.env.MCPILOT_TOKEN || "mcpilot-secret-2024";

export interface McpilotRawResponse {
  ok: boolean;
  content: string;
  isError: boolean;
  error?: string;
}

export interface McpilotHealth {
  status: string;
  service: string;
  version: string;
  tools: number;
  adminModeEnabled: boolean;
}

export interface McpilotCallResult {
  ok: boolean;
  isError: boolean;
  /** Raw string content returned by MCPilot (often a JSON-encoded string). */
  content: string;
  /** Parsed content if it was JSON, else null. */
  parsed: unknown;
  /** Wall-clock duration of the upstream call, in ms. */
  durationMs: number;
  /** HTTP status from MCPilot. */
  status: number;
  error?: string;
}

/**
 * Call a single MCPilot tool. Always uses fetch.
 */
export async function callMcpilotTool(
  tool: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<McpilotCallResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let status = 0;
  let raw: McpilotRawResponse | null = null;
  let error: string | undefined;

  try {
    const res = await fetch(`${MCPILOT_BASE_URL}/api/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MCPILOT_TOKEN}`,
      },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
      // Do not cache tool calls.
      cache: "no-store",
    });
    status = res.status;
    const text = await res.text();
    try {
      raw = JSON.parse(text) as McpilotRawResponse;
    } catch {
      // Non-JSON upstream response.
      error = `Upstream returned non-JSON (status ${res.status}): ${text.slice(0, 300)}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (error.includes("aborted")) error = `Request timed out after ${timeoutMs} ms`;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - start;
  const content = raw?.content ?? "";
  let parsed: unknown = null;
  if (content) {
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
  }

  return {
    ok: raw?.ok ?? false,
    isError: raw?.isError ?? !!error,
    content,
    parsed,
    durationMs,
    status,
    error,
  };
}

/**
 * Fetch MCPilot /health. Always uses fetch.
 */
export async function getMcpilotHealth(): Promise<{
  health: McpilotHealth | null;
  status: number;
  error?: string;
}> {
  try {
    const res = await fetch(`${MCPILOT_BASE_URL}/health`, {
      headers: { Authorization: `Bearer ${MCPILOT_TOKEN}` },
      cache: "no-store",
    });
    const text = await res.text();
    let health: McpilotHealth | null = null;
    try {
      health = JSON.parse(text) as McpilotHealth;
    } catch {
      // ignore
    }
    return { health, status: res.status };
  } catch (e) {
    return {
      health: null,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
