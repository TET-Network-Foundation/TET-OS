export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

function absoluteOrigin(raw: string | undefined): string {
  const v = raw?.trim() ?? "";
  return /^https?:\/\//i.test(v) ? v.replace(/\/+$/, "") : "";
}

function candidateOrigins(): string[] {
  const origins = [
    absoluteOrigin(process.env.TET_CORE_ORIGIN),
    absoluteOrigin(process.env.NEXT_PUBLIC_API_URL),
    absoluteOrigin(process.env.NEXT_PUBLIC_TET_CORE_URL),
    "http://127.0.0.1:5010",
    "http://127.0.0.1:8080",
    "http://localhost:5010",
    "http://localhost:8080",
  ].filter(Boolean);
  return Array.from(new Set(origins));
}

function proxyHeaders(req: Request): Headers {
  const h = new Headers(req.headers);
  h.delete("host");
  h.delete("connection");
  h.delete("content-length");
  h.delete("accept-encoding");
  return h;
}

async function proxyTetCore(req: Request, ctx: RouteContext): Promise<Response> {
  const params = await ctx.params;
  const path = (params.path ?? []).map((part) => encodeURIComponent(part)).join("/");
  const sourceUrl = new URL(req.url);
  const suffix = `/${path}${sourceUrl.search}`;
  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
  const tried: string[] = [];
  let lastError = "";

  for (const origin of candidateOrigins()) {
    const target = `${origin}${suffix}`;
    tried.push(target);
    try {
      const upstream = await fetch(target, {
        method,
        headers: proxyHeaders(req),
        body,
        cache: "no-store",
        redirect: "manual",
      });
      const payload = await upstream.arrayBuffer();
      const headers = new Headers();
      const contentType = upstream.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      headers.set("x-tet-core-origin", origin);

      if ((upstream.status === 404 || upstream.status === 502) && origin !== candidateOrigins().at(-1)) {
        lastError = `HTTP ${upstream.status}`;
        continue;
      }

      return new Response(payload, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return Response.json(
    {
      ok: false,
      message: "tet-core unavailable",
      detail: lastError,
      tried,
    },
    { status: 502 },
  );
}

export function GET(req: Request, ctx: RouteContext) {
  return proxyTetCore(req, ctx);
}

export function POST(req: Request, ctx: RouteContext) {
  return proxyTetCore(req, ctx);
}

export function PUT(req: Request, ctx: RouteContext) {
  return proxyTetCore(req, ctx);
}

export function PATCH(req: Request, ctx: RouteContext) {
  return proxyTetCore(req, ctx);
}

export function DELETE(req: Request, ctx: RouteContext) {
  return proxyTetCore(req, ctx);
}
