// Shared CORS + JSON helpers + a light client-key gate for Plan & Pay Edge Functions.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // demo: tighten to your Vercel domain for real use
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Wraps a handler with CORS preflight, POST-only, JSON parsing and error mapping. */
export function serveJson(
  handler: (body: Record<string, unknown>, req: Request) => Promise<unknown>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    try {
      requireClientKey(req);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new HttpError(400, "Body must be JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "Body must be a JSON object");
      }
      return json(await handler(body as Record<string, unknown>, req));
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, details: err.details ?? null }, err.status);
      }
      console.error(err);
      // supabase-js returns PostgrestError-shaped plain objects, so don't let them become "[object Object]".
      const message = err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
      return json({ error: "Internal error", details: message }, 500);
    }
  };
}

/**
 * Light gate. Functions are deployed with verify_jwt=false, because the new sb_publishable_ keys
 * are not JWTs. So require that the caller sends one of this project's publishable/anon keys.
 * Those keys are PUBLIC, so this only stops drive-by callers. It is not auth.
 * Set DISABLE_CLIENT_KEY_CHECK=true to turn it off.
 */
export function requireClientKey(req: Request): void {
  if (Deno.env.get("DISABLE_CLIENT_KEY_CHECK") === "true") return;
  const allowed = new Set<string>();
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) allowed.add(anon);
  const pub = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (pub) {
    try {
      for (const v of Object.values(JSON.parse(pub) as Record<string, string>)) allowed.add(v);
    } catch { /* ignore malformed */ }
  }
  const single = Deno.env.get("SUPABASE_PUBLISHABLE_KEY"); // local CLI single-key setup
  if (single) allowed.add(single);
  if (allowed.size === 0) return; // nothing configured (e.g. bare local run)

  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!allowed.has(apikey) && !allowed.has(bearer)) {
    throw new HttpError(401, "Missing or unknown project key (send the publishable/anon key as `apikey`).");
  }
}

export function reqString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(400, `\`${key}\` is required`);
  return v.trim();
}

export function optString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new HttpError(400, `\`${key}\` must be a string`);
  return v.trim();
}

export function optInt(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new HttpError(400, `\`${key}\` must be a non-negative integer (cents)`);
  }
  return v;
}
