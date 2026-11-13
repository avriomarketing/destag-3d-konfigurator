// destag-pdf: speichert das Konfigurations-PDF aus dem Destag-Konfigurator und liefert es per Link aus.
// Projekt: avrio-services (sxaflpiqtgwfzkybmwzn), privater Bucket "destag-pdf".
//
// Ablauf: Der Browser erzeugt eine zufaellige UUID, gibt den Link schon an Typeform weiter
// (verstecktes Feld config_pdf), schickt sofort ein kleines Datenpaket und laedt das PDF danach
// im Hintergrund hoch.
//
//   POST ?id=<uuid>                 Body: PDF-Bytes  ->  {"link": "https://.../destag-pdf?id=<uuid>"}
//   POST ?aktion=daten&id=<uuid>    Body: JSON (Modell, Eigenschaften, Link, kleines Bild)
//   POST ?aktion=fehler&id=<uuid>   Body: JSON-Meldung aus dem Browser, landet nur im Funktions-Log
//   GET  ?id=<uuid>                 ->  das PDF (fuer Destag aus der Typeform-Anfrage heraus)
//   POST ?aktion=aufraeumen         Header x-aufraeumen-schluessel  ->  {"geloescht": n}
//
// Fehlt das PDF beim Abruf, wartet GET bis zu WARTEN_MS darauf. Kommt es nicht, baut die Funktion
// aus dem Datenpaket ein Ersatz-PDF (gleiche Vorlage, alle Eigenschaften, Link, kleines Bild),
// damit jede Anfrage ein PDF hat. Das Ersatz-PDF wird nicht gespeichert: Kommt das echte PDF
// spaeter doch noch an, liefert der Link ab dann dieses aus.
//
// Datenschutz: Die UUID ist nicht erratbar. PDFs und Datenpakete werden nach AUFBEWAHRUNG_TAGE
// nicht mehr ausgeliefert und einmal taeglich vom pg_cron-Job "destag-pdf-aufraeumen" geloescht.
// Dessen Schluessel liegt im Vault ("destag_pdf_aufraeumen").

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const ORIGINS = new Set([
  "https://destag-grabmale.de",
  "https://www.destag-grabmale.de",
  "https://destag-grabmale.webflow.io",
]);
const BUCKET = "destag-pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DATEN = 150 * 1024;
const MAX_MELDUNG = 4000;
const AUFBEWAHRUNG_TAGE = 30;
const LOESCH_SEITE = 100;
const WARTEN_MS = 12_000;
const PRUEF_ABSTAND_MS = 1_500;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LINK_BASIS = `${Deno.env.get("SUPABASE_URL")}/functions/v1/destag-pdf`;

// Vorlage fuer das Ersatz-PDF: nur aus dem eigenen Repo, sonst die feste Fassung.
const VORLAGE_REGEX =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/avriomarketing\/destag-3d-konfigurator@(v\d+\.\d+\.\d+|[0-9a-f]{7,40})\/public\/assets\/pdftemplate\.pdf$/;
const VORLAGE_STANDARD =
  "https://cdn.jsdelivr.net/gh/avriomarketing/destag-3d-konfigurator@v1.0.8/public/assets/pdftemplate.pdf";
const MM2PT = 2.83465;

const PDF_HEADER = {
  "Content-Type": "application/pdf",
  "Content-Disposition": 'inline; filename="Destag-Grabmal-Konfiguration.pdf"',
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Daten = {
  zeit: string;
  modell: string;
  groesse: string;
  link: string;
  zeilen: string[];
  vorlage: string;
  bild?: string;
};

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

function abgelaufen(datei: { created_at?: string | null }): boolean {
  return !!datei.created_at && Date.parse(datei.created_at) < grenzeAbgelaufen();
}

async function dateiInfo(name: string) {
  const { data } = await db.storage.from(BUCKET).list("", { search: name, limit: 1 });
  return data?.find((f) => f.name === name) ?? null;
}

// Loescht seitenweise die aeltesten Dateien, bis keine abgelaufene mehr uebrig ist.
async function alteLoeschen(): Promise<number> {
  let geloescht = 0;
  while (true) {
    const { data, error } = await db.storage.from(BUCKET).list("", {
      limit: LOESCH_SEITE,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error || !data) {
      if (error) console.error("Aufraeumen: Liste nicht lesbar:", error.message);
      return geloescht;
    }
    const alt = data
      .filter((f) => f.created_at && Date.parse(f.created_at) < grenzeAbgelaufen())
      .map((f) => f.name);
    if (!alt.length) return geloescht;
    const { error: e } = await db.storage.from(BUCKET).remove(alt);
    if (e) {
      console.error("Aufraeumen fehlgeschlagen:", e.message);
      return geloescht;
    }
    geloescht += alt.length;
    if (alt.length < data.length || data.length < LOESCH_SEITE) return geloescht;
  }
}

async function aufraeumen(req: Request): Promise<Response> {
  const { data: schluessel, error } = await db.rpc("get_service_secret", {
    secret_name: "destag_pdf_aufraeumen",
  });
  if (error || typeof schluessel !== "string" || !schluessel) {
    console.error("Aufraeum-Schluessel nicht lesbar:", error?.message);
    return json(500, { error: "nicht_eingerichtet" }, null);
  }
  if (req.headers.get("x-aufraeumen-schluessel") !== schluessel) {
    return json(403, { error: "nicht_erlaubt" }, null);
  }
  return json(200, { geloescht: await alteLoeschen() }, null);
}

async function speichern(name: string, bytes: Uint8Array, contentType: string, origin: string) {
  const { error } = await db.storage.from(BUCKET).upload(name, bytes, { contentType, upsert: false });
  if (!error) return null;
  const vorhanden = /exist|duplicate/i.test(error.message);
  if (!vorhanden) console.error(`Speichern von ${name} fehlgeschlagen:`, error.message);
  return json(vorhanden ? 409 : 500, { error: vorhanden ? "id_vergeben" : "upload_fehler" }, origin);
}

async function hochladen(req: Request, id: string, origin: string): Promise<Response> {
  const laenge = Number(req.headers.get("Content-Length") ?? 0);
  if (laenge > MAX_BYTES) return json(413, { error: "zu_gross" }, origin);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return json(413, { error: "zu_gross" }, origin);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    return json(400, { error: "kein_pdf" }, origin);
  }

  const fehler = await speichern(`${id}.pdf`, bytes, "application/pdf", origin);
  return fehler ?? json(201, { link: `${LINK_BASIS}?id=${id}` }, origin);
}

function textFeld(wert: unknown, max: number): string {
  return typeof wert === "string" ? wert.slice(0, max) : "";
}

function datenPruefen(roh: Record<string, unknown>): Daten | null {
  const link = textFeld(roh.link, 2000);
  if (!/^https:\/\/\S+$/.test(link)) return null;

  const zeilen = Array.isArray(roh.zeilen)
    ? roh.zeilen.filter((z): z is string => typeof z === "string").slice(0, 60).map((z) => z.slice(0, 300))
    : [];
  const bild = typeof roh.bild === "string" && roh.bild.length <= MAX_DATEN &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(roh.bild)
    ? roh.bild
    : undefined;
  const vorlage = typeof roh.vorlage === "string" && VORLAGE_REGEX.test(roh.vorlage) ? roh.vorlage : VORLAGE_STANDARD;

  return {
    zeit: textFeld(roh.zeit, 40),
    modell: textFeld(roh.modell, 200),
    groesse: textFeld(roh.groesse, 300),
    link,
    zeilen,
    vorlage,
    ...(bild ? { bild } : {}),
  };
}

async function datenSpeichern(req: Request, id: string, origin: string): Promise<Response> {
  const roh = await req.text();
  if (!roh || roh.length > MAX_DATEN) return json(413, { error: "zu_gross" }, origin);

  let daten: Daten | null = null;
  try {
    daten = datenPruefen(JSON.parse(roh));
  } catch {
    // unten als ungueltig behandelt
  }
  if (!daten) return json(400, { error: "daten_ungueltig" }, origin);

  const bytes = new TextEncoder().encode(JSON.stringify(daten));
  const fehler = await speichern(`${id}.json`, bytes, "application/json", origin);
  return fehler ?? json(201, { gespeichert: true }, origin);
}

// Meldungen aus dem Browser (Fehler, Seite zu frueh verlassen). Nur fuers Funktions-Log.
async function meldung(req: Request, id: string, origin: string): Promise<Response> {
  const inhalt = (await req.text()).slice(0, MAX_MELDUNG).replace(/[\r\n]+/g, " ");
  console.warn(`PDF-Meldung ${UUID_REGEX.test(id) ? id : "ohne-id"}: ${inhalt}`);
  return json(204, null, origin);
}

const vorlagen = new Map<string, Promise<Uint8Array>>();

function vorlageLaden(url: string): Promise<Uint8Array> {
  if (!vorlagen.has(url)) {
    const laden = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`Vorlage HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    laden.catch(() => vorlagen.delete(url));
    vorlagen.set(url, laden);
  }
  return vorlagen.get(url)!;
}

// Die Standardschrift kann nur WinAnsi; alles andere wird zu "?" statt das PDF zu verhindern.
function druckbar(wert: string, font: PDFFont): string {
  let ergebnis = "";
  for (const zeichen of wert.replace(/[\r\n\t]+/g, " ")) {
    try {
      font.encodeText(zeichen);
      ergebnis += zeichen;
    } catch {
      ergebnis += "?";
    }
  }
  return ergebnis;
}

// Gleiches Layout wie DestagPDF.build() im Browser (includes/generate-pdf.js).
async function ersatzPdf(d: Daten): Promise<Uint8Array> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(await vorlageLaden(d.vorlage));
  } catch (err) {
    console.error("Ersatz-PDF: Vorlage nicht ladbar, PDF ohne Vorlage:", err);
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage();
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const ersteSeite = pdfDoc.getPages()[0];
  const zweiteSeite = pdfDoc.getPages()[1] || pdfDoc.addPage();
  const { height } = ersteSeite.getSize();

  const schreiben = (seite: PDFPage, txt: string, x: number, y: number, size = 10) =>
    seite.drawText(druckbar(String(txt), font), {
      x: x * MM2PT,
      y: height - (y * MM2PT),
      size,
      font,
      color: rgb(0, 0, 0),
    });
  const zeichnen = (seite: PDFPage, bild: PDFImage, x: number, y: number, w: number, h: number) =>
    seite.drawImage(bild, {
      x: x * MM2PT,
      y: height - ((y + h) * MM2PT),
      width: w * MM2PT,
      height: h * MM2PT,
    });

  let bild: PDFImage | null = null;
  if (d.bild) {
    try {
      bild = await pdfDoc.embedJpg(d.bild);
    } catch (err) {
      console.error("Ersatz-PDF: Bild nicht lesbar:", err);
    }
  }

  schreiben(ersteSeite, d.zeit, 11, 124);
  schreiben(ersteSeite, d.modell, 11, 146);
  schreiben(ersteSeite, d.groesse, 11, 167.5);
  schreiben(ersteSeite, d.link, 11, 189);

  if (bild) {
    zeichnen(ersteSeite, bild, 97.5, 16, 90, 90);
  } else {
    schreiben(ersteSeite, "Vorschaubild nicht verfügbar.", 100, 58, 9);
    schreiben(ersteSeite, "Konfiguration über den Link öffnen.", 100, 63, 9);
  }

  let zeileY = 125;
  for (const zeile of d.zeilen) {
    schreiben(ersteSeite, zeile, 88, zeileY);
    zeileY += 5.5;
  }

  if (bild) zeichnen(zweiteSeite, bild, 31, 33.5, 154, 154);
  schreiben(zweiteSeite, d.modell, 11, 204);
  schreiben(
    zweiteSeite,
    bild
      ? "Ersatz-PDF aus den übermittelten Konfigurationsdaten, Vorschaubild in reduzierter Auflösung."
      : "Ersatz-PDF aus den übermittelten Konfigurationsdaten, ohne Vorschaubild.",
    11,
    212,
    8,
  );

  return await pdfDoc.save();
}

async function ersatzAusliefern(id: string): Promise<Response> {
  const { data, error } = await db.storage.from(BUCKET).download(`${id}.json`);
  if (error || !data) return text(404, "Dieses PDF wurde nicht gefunden.");

  try {
    const daten = datenPruefen(JSON.parse(await data.text()));
    if (!daten) throw new Error("Datenpaket unvollständig");
    const bytes = await ersatzPdf(daten);
    console.warn(`PDF-Meldung ${id}: Ersatz-PDF ausgeliefert`);
    return new Response(new Blob([bytes as BlobPart], { type: "application/pdf" }), {
      status: 200,
      headers: PDF_HEADER,
    });
  } catch (err) {
    console.error(`Ersatz-PDF ${id} fehlgeschlagen:`, err);
    return text(500, "Das PDF konnte nicht erstellt werden.");
  }
}

async function ausliefern(id: string): Promise<Response> {
  let pdf = await dateiInfo(`${id}.pdf`);

  if (!pdf) {
    const daten = await dateiInfo(`${id}.json`);
    if (!daten) return text(404, "Dieses PDF wurde nicht gefunden.");
    if (abgelaufen(daten)) return text(410, "Dieser Link ist abgelaufen.");

    // Der Browser laedt das PDF evtl. gerade noch hoch.
    const ende = Date.now() + WARTEN_MS;
    while (!pdf && Date.now() < ende) {
      await new Promise((r) => setTimeout(r, PRUEF_ABSTAND_MS));
      pdf = await dateiInfo(`${id}.pdf`);
    }
    if (!pdf) return ersatzAusliefern(id);
  }

  if (abgelaufen(pdf)) return text(410, "Dieser Link ist abgelaufen.");

  const { data, error } = await db.storage.from(BUCKET).download(`${id}.pdf`);
  if (error || !data) return text(404, "Dieses PDF wurde nicht gefunden.");

  return new Response(data.stream(), { status: 200, headers: PDF_HEADER });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const parameter = new URL(req.url).searchParams;
  const id = parameter.get("id") ?? "";
  const aktion = parameter.get("aktion");

  if (req.method === "POST" && aktion === "aufraeumen") return aufraeumen(req);
  if (req.method === "GET") {
    return UUID_REGEX.test(id) ? ausliefern(id) : text(404, "Dieses PDF wurde nicht gefunden.");
  }

  if (!origin || !ORIGINS.has(origin)) return json(403, { error: "origin_nicht_erlaubt" }, null);
  if (req.method === "OPTIONS") return json(204, null, origin);
  if (req.method !== "POST") return json(405, { error: "nur_get_post" }, origin);
  if (aktion === "fehler") return meldung(req, id, origin);
  if (!UUID_REGEX.test(id)) return json(400, { error: "id_ungueltig" }, origin);
  if (aktion === "daten") return datenSpeichern(req, id, origin);

  return hochladen(req, id, origin);
});
