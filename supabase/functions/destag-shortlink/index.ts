// destag-shortlink: kuerzt Konfigurator-Links von Destag ueber Bitly.
// Projekt: avrio-services (sxaflpiqtgwfzkybmwzn).
//
// Der Browser ruft die Funktion direkt auf (verify_jwt = false).
// Darum prueft sie selbst: nur Anfragen von Destags Seiten, nur Links auf /konfigurator/.
// Der Bitly-Token liegt im Vault des Projekts (Name "bitly_token") und wird ueber
// public.get_service_secret gelesen. Ein Function-Secret BITLY_TOKEN hat Vorrang.
//
//   POST {"url": "https://www.destag-grabmale.de/konfigurator/..."}  ->  {"link": "https://bit.ly/..."}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const DOMAINS = new Set([
  "destag-grabmale.de",
  "www.destag-grabmale.de",
  "destag-grabmale.webflow.io",
]);
const ORIGINS = new Set([...DOMAINS].map((d) => `https://${d}`));
const BITLY_TIMEOUT_MS = 5000;

let bitlyToken: string | null = Deno.env.get("BITLY_TOKEN") ?? null;

async function holeToken(): Promise<string | null> {
  if (bitlyToken) return bitlyToken;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.rpc("get_service_secret", { secret_name: "bitly_token" });
  if (error) {
    console.error("Vault nicht lesbar:", error.message);
    return null;
  }
  bitlyToken = typeof data === "string" && data ? data : null;
  return bitlyToken;
}

function antwort(status: number, body: unknown, origin: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  if (origin && ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function erlaubterLink(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  let url: URL;
  try {
    url = new URL(wert);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !DOMAINS.has(url.hostname)) return null;
  if (url.username || url.password || url.port) return null;
  if (!url.pathname.startsWith("/konfigurator/")) return null;
  return url.toString();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (!origin || !ORIGINS.has(origin)) {
    return antwort(403, { error: "origin_nicht_erlaubt" }, null);
  }
  if (req.method === "OPTIONS") return antwort(204, null, origin);
  if (req.method !== "POST") return antwort(405, { error: "nur_post" }, origin);

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return antwort(400, { error: "kein_json" }, origin);
  }
  const langerLink = erlaubterLink(body?.url);
  if (!langerLink) return antwort(400, { error: "url_nicht_erlaubt" }, origin);

  const token = await holeToken();
  if (!token) {
    console.error("Bitly-Token fehlt");
    return antwort(500, { error: "nicht_eingerichtet" }, origin);
  }

  let bitly: Response;
  try {
    bitly = await fetch("https://api-ssl.bitly.com/v4/shorten", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ long_url: langerLink }),
      signal: AbortSignal.timeout(BITLY_TIMEOUT_MS),
    });
  } catch (e) {
    const zeit = e instanceof DOMException && e.name === "TimeoutError";
    console.error("Bitly nicht erreichbar:", e);
    return antwort(zeit ? 504 : 502, { error: zeit ? "bitly_timeout" : "bitly_fehler" }, origin);
  }

  if (!bitly.ok) {
    console.error("Bitly antwortet", bitly.status, await bitly.text());
    return antwort(502, { error: "bitly_fehler" }, origin);
  }
  const daten = await bitly.json();
  if (typeof daten?.link !== "string") {
    console.error("Bitly ohne link:", daten);
    return antwort(502, { error: "bitly_fehler" }, origin);
  }
  return antwort(200, { link: daten.link }, origin);
});
