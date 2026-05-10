export const runtime = "nodejs";

function ollamaBaseUrl() {
  return process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "fetch failed";
  }
}

export async function GET() {
  try {
    const r = await fetch(new URL("/api/tags", ollamaBaseUrl()).toString(), {
      method: "GET",
      cache: "no-store",
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: unknown) {
    return new Response(
      JSON.stringify({ ok: false, error: "ollama_unreachable", message: errMessage(e) }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

