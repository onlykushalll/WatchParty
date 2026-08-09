import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REDIRECTS = 5;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB cap per response

// SSRF guard: block obvious internal addresses.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h)
  );
}

async function fetchFollowingRedirects(
  url: string,
  hops = 0,
): Promise<{ res: Response; finalUrl: string }> {
  if (hops > MAX_REDIRECTS) {
    throw new Error("Too many redirects");
  }
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported protocol");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("Blocked host");
  }

  const parsedUrl = new URL(url);
  const res = await fetch(url, {
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Referer": parsedUrl.origin + "/",
    },
  });

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error("Redirect without Location");
    const next = new URL(loc, url).toString();
    // Consume the body to free the connection.
    await res.body?.cancel();
    return fetchFollowingRedirects(next, hops + 1);
  }
  return { res, finalUrl: url };
}

/**
 * GET /api/proxy?url=<encoded-url>
 *
 * Reverse proxy that:
 *  - follows 301/302/303/307/308 redirects (up to 5 hops)
 *  - strips X-Frame-Options and Content-Security-Policy frame-ancestors
 *  - rewrites relative URLs in HTML so resources resolve through the proxy
 *
 * This lets us embed pages in an <iframe> that would otherwise refuse to
 * be framed. NOTE: this is best-effort and will NOT bypass sites that
 * require login or use aggressive JS-based frame-busting. For those, the
 * "Remote PC" feature (MCPilot browser automation) is the right tool.
 */
export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  if (!urlParam) {
    return NextResponse.json(
      { ok: false, error: "Missing 'url' query parameter" },
      { status: 400 },
    );
  }

  let finalRes: Response;
  let finalUrl: string;
  try {
    ({ res: finalRes, finalUrl } = await fetchFollowingRedirects(urlParam));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Proxy error" },
      { status: 502 },
    );
  }

  const contentType = finalRes.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");

  // Build a clean set of response headers.
  const headers = new Headers();
  for (const [k, v] of finalRes.headers.entries()) {
    const lk = k.toLowerCase();
    // Strip framing blockers.
    if (lk === "x-frame-options") continue;
    if (lk === "content-security-policy") continue;
    if (lk === "content-security-policy-report-only") continue;
    // Let the browser handle these fresh.
    if (lk === "content-encoding") continue;
    if (lk === "content-length") continue;
    if (lk === "transfer-encoding") continue;
    if (lk === "connection") continue;
    headers.set(k, v);
  }
  // Allow framing by anyone.
  headers.set("X-Frame-Options", "ALLOWALL");
  headers.delete("content-security-policy");

  const buffer = await finalRes.arrayBuffer().then((b) => {
    if (b.byteLength > MAX_BYTES) {
      throw new Error("Response too large");
    }
    return b;
  });

  let body: Buffer | ArrayBuffer = buffer;
  if (isHtml) {
    // Rewrite absolute/relative URLs in the HTML so sub-resources and links
    // go through our proxy too. This is a lightweight regex rewrite — it
    // won't handle every SPA but covers the common cases.
    let html = Buffer.from(buffer).toString("utf-8");
    const proxyBase = `/api/proxy?url=`;
    const finalOrigin = new URL(finalUrl).origin;

    // Rewrite src=, href=, action= that point to absolute or root-relative URLs.
    html = html.replace(
      /(src|href|action)=(["'])(\/[^"']*|https?:\/\/[^"']*)["']/gi,
      (_m, attr: string, quote: string, val: string) => {
        let abs: string;
        if (val.startsWith("http://") || val.startsWith("https://")) {
          abs = val;
        } else if (val.startsWith("//")) {
          abs = finalOrigin.replace(/^https?:/, "") + val;
        } else if (val.startsWith("/")) {
          abs = finalOrigin + val;
        } else {
          return `${attr}=${quote}${val}${quote}`;
        }
        return `${attr}=${quote}${proxyBase}${encodeURIComponent(abs)}${quote}`;
      },
    );

    body = Buffer.from(html, "utf-8");
    headers.set("content-type", "text/html; charset=utf-8");
  }

  return new NextResponse(new Uint8Array(body), {
    status: finalRes.status,
    headers,
  });
}
