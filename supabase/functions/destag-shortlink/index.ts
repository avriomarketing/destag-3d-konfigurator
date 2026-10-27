/**
 * destag-shortlink
 *
 * Erzeugt Bitly-Kurzlinks für den DESTAG 3D-Grabmal-Konfigurator.
 * Ersetzt das frühere services.php?path=urlconverter auf cdn.avrio-hosting.de.
 *
 * Request:  POST { "url": "https://www.destag-grabmale.de/konfigurator/...?m123=456&a789=..." }
 * Response: 200  { "link": "https://bit.ly/xyz" }
 *           4xx/5xx { "error": "<code>" }
 *
 * Voraussetzungen:
 * - Secret BITLY_TOKEN (Bitly Generic Access Token)
 * - verify_jwt = false (Aufruf erfolgt direkt aus dem Browser ohne Supabase-Key)
 */

const ALLOWED_ORIGINS = new Set([
    "https://www.destag-grabmale.de",
    "https://destag-grabmale.de",
    "https://destag-grabmale.webflow.io",
]);

const ALLOWED_TARGET_HOSTS = new Set([
    "www.destag-grabmale.de",
    "destag-grabmale.de",
    "destag-grabmale.webflow.io",
]);

const ALLOWED_TARGET_PATH_PREFIX = "/konfigurator/";
const MAX_URL_LENGTH = 4000;
const BITLY_TIMEOUT_MS = 5000;

function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
}

function parseTarget(raw: unknown): URL | null {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    if (url.protocol !== "https:") return null;
    if (!ALLOWED_TARGET_HOSTS.has(url.hostname)) return null;
    if (!url.pathname.startsWith(ALLOWED_TARGET_PATH_PREFIX)) return null;

    return url;
}

Deno.serve(async (req) => {
    const origin = req.headers.get("Origin");

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (req.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, origin);
    }

    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return json({ error: "origin_not_allowed" }, 403, origin);
    }

    let body: { url?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: "invalid_body" }, 400, origin);
    }

    const target = parseTarget(body?.url);
    if (!target) {
        return json({ error: "target_not_allowed" }, 400, origin);
    }

    const token = Deno.env.get("BITLY_TOKEN");
    if (!token) {
        console.error("BITLY_TOKEN is not configured.");
        return json({ error: "not_configured" }, 500, origin);
    }

    try {
        const res = await fetch("https://api-ssl.bitly.com/v4/shorten", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ long_url: target.toString() }),
            signal: AbortSignal.timeout(BITLY_TIMEOUT_MS),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || typeof data?.link !== "string") {
            console.error("Bitly request failed:", res.status, data);
            return json({ error: "bitly_failed" }, 502, origin);
        }

        return json({ link: data.link }, 200, origin);
    } catch (err) {
        console.error("Bitly unreachable:", err);
        return json({ error: "bitly_unreachable" }, 502, origin);
    }
});
