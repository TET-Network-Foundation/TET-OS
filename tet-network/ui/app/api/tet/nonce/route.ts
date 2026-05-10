export const runtime = "nodejs";

function tetCoreBaseUrl() {
  const url =
    process.env.TET_CORE_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_TET_CORE_URL?.trim() ||
    "";
  return /^https?:\/\//i.test(url) ? url : "http://127.0.0.1:5010";
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "fetch failed";
  }
}

const rl = new Map<string, { ts: number; count: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = rl.get(key);
  if (!cur || now - cur.ts > windowMs) {
    rl.set(key, { ts: now, count: 1 });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}

export async function GET(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!rateLimit(`nonce:${ip}`, 60, 60_000)) {
      return new Response(JSON.stringify({ ok: false, message: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }

    const { searchParams } = new URL(req.url);
    const walletId = (searchParams.get("wallet_id") ?? "").trim();
    if (!walletId) {
      return new Response(JSON.stringify({ ok: false, message: "wallet_id required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const u = new URL("/ai/nonce", tetCoreBaseUrl());
    u.searchParams.set("wallet_id", walletId);

    const r = await fetch(u.toString(), { method: "GET", cache: "no-store" });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ ok: false, message: errMessage(e) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

