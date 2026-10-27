# DESTAG 3D-Grabmal-Konfigurator (Webflow-Integration)

Frontend-Integration des Expivi-3D-Konfigurators in die Webflow-Site destag-grabmale.de.
Ausgeliefert über jsDelivr direkt aus diesem Repo, versioniert über Git-Tags.

## Einbindung in Webflow (Page Settings → Inside `<head>`)

```html
<script src="https://cdn.jsdelivr.net/gh/avriomarketing/destag-3d-konfigurator@v1.0.0/public/app.js"></script>
<script>
  document.addEventListener("DOMContentLoaded", () => {
    new window.WebflowApp({ catalogueId: '4780' }).init();
  });
</script>
```

`app.js` lädt `app.css`, `includes/*` und `assets/*` automatisch aus demselben Release (gleicher Tag).

## Aufbau

- `public/app.js` – `WebflowApp`: lädt Expivi, Typeform, verdrahtet Teilen/PDF/Typeform
- `public/includes/` – bei Bedarf nachgeladen: Daten (`data.js`), Kurzlinks (`link-converter.js`), PDF (`generate-pdf.js`)
- `public/assets/` – PDF-Vorlage, pdf-lib, Logo
- `supabase/functions/destag-shortlink/` – Edge Function für Bitly-Kurzlinks (Referenz; deployt im Supabase-Projekt `middleware`, Secret `BITLY_TOKEN`)
- `redirects/konfigurator-subdomain.htaccess` – 301-Weiterleitungen vom alten WordPress-Konfigurator

## Neue Version veröffentlichen

1. Änderungen committen und pushen
2. Neuen Tag setzen: `git tag v1.0.1 && git push origin v1.0.1`
3. In Webflow auf allen Konfigurator-Seiten die Version in der Script-URL anpassen, publishen
