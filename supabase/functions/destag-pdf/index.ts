// destag-pdf: speichert das Konfigurations-PDF aus dem Destag-Konfigurator und liefert es per Link aus.
// Projekt: avrio-services (sxaflpiqtgwfzkybmwzn), privater Bucket "destag-pdf".
//
// Ablauf: Der Browser erzeugt eine zufaellige UUID, gibt den Link schon an Typeform weiter
// (verstecktes Feld config_pdf) und laedt das PDF danach im Hintergrund hoch.
//
//   POST ?id=<uuid>  Body: PDF-Bytes (nur von Destags Seiten)  ->  {"link": "https://.../destag-pdf?id=<uuid>"}
//   GET  ?id=<uuid>  ->  das PDF (fuer Destag aus der Typeform-Anfrage heraus)
//
// Datenschutz: Die UUID ist nicht erratbar. PDFs werden nach AUFBEWAHRUNG_TAGE nicht mehr
// ausgeliefert und beim naechsten Upload geloescht.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINS = new Set([
  "https://destag-grabmale.de",
  "https://www.destag-grabmale.de",
  "https://destag-grabmale.webflow.io",
]);
const BUCKET = "destag-pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const AUFBEWAHRUNG_TAGE = 90;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LINK_BASIS = `${Deno.env.get("SUPABASE_URL")}/functions/v1/destag-pdf`;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(status: number, body: unknown, origin: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Vary": "Origin" };
  if (origin && ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function text(status: number, nachricht: string): Response {
  return new Response(nachricht, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

function grenzeAbgelaufen(): number {
  return Date.now() - AUFBEWAHRUNG_TAGE * 24 * 60 * 60 * 1000;
}

async function alteLoeschen(): Promise<void> {
  const { data, error } = await db.storage.from(BUCKET).list("", {
    limit: 100,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error || !data) return;
  const alt = data
    .filter((f) => f.created_at && Date.parse(f.created_at) < grenzeAbgelaufen())
    .map((f) => f.name);
  if (alt.length) {
    const { error: e } = await db.storage.from(BUCKET).remove(alt);
    if (e) console.error("Aufraeumen fehlgeschlagen:", e.message);
  }
}

async function hochladen(req: Request, id: string, origin: string): Promise<Response> {
  const laenge = Number(req.headers.get("Content-Length") ?? 0);
  if (laenge > MAX_BYTES) return json(413, { error: "zu_gross" }, origin);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return json(413, { error: "zu_gross" }, origin);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    return json(400, { error: "kein_pdf" }, origin);
  }

  const { error } = await db.storage.from(BUCKET).upload(`${id}.pdf`, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) {
    const vorhanden = /exist|duplicate/i.test(error.message);
    if (!vorhanden) console.error("Upload fehlgeschlagen:", error.message);
    return json(vorhanden ? 409 : 500, { error: vorhanden ? "id_vergeben" : "upload_fehler" }, origin);
  }

  EdgeRuntime.waitUntil(alteLoeschen());
  return json(201, { link: `${LINK_BASIS}?id=${id}` }, origin);
}

async function ausliefern(id: string): Promise<Response> {
  const { data: treffer } = await db.storage.from(BUCKET).list("", { search: `${id}.pdf`, limit: 1 });
  const datei = treffer?.find((f) => f.name === `${id}.pdf`);
  if (!datei) return text(404, "Dieses PDF wurde nicht gefunden.");
  if (datei.created_at && Date.parse(datei.created_at) < grenzeAbgelaufen()) {
    return text(410, "Dieser Link ist abgelaufen.");
  }

  const { data, error } = await db.storage.from(BUCKET).download(`${id}.pdf`);
  if (error || !data) return text(404, "Dieses PDF wurde nicht gefunden.");

  return new Response(data.stream(), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Destag-Grabmal-Konfiguration.pdf"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const id = new URL(req.url).searchParams.get("id") ?? "";

  if (req.method === "GET") {
    return UUID_REGEX.test(id) ? ausliefern(id) : text(404, "Dieses PDF wurde nicht gefunden.");
  }

  if (!origin || !ORIGINS.has(origin)) return json(403, { error: "origin_nicht_erlaubt" }, null);
  if (req.method === "OPTIONS") return json(204, null, origin);
  if (req.method !== "POST") return json(405, { error: "nur_get_post" }, origin);
  if (!UUID_REGEX.test(id)) return json(400, { error: "id_ungueltig" }, origin);

  return hochladen(req, id, origin);
});
