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

export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!rateLimit(`infer:${ip}`, 30, 60_000)) {
      return new Response(JSON.stringify({ ok: false, message: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }

    const payload = await req.json();
    const r = await fetch(new URL("/ai/infer_signed", tetCoreBaseUrl()).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
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

