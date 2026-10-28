const MM2PT = 2.83465;
const INVALID_VALUES = new Set(["null", "false", "leer", "test", "temp-delete", "hidden_text", "Disabled", "Inschrift"]);
const CLEANUP_REGEX = /@size:(1|0\.75)|@font:(Josefin Sans|Newsreader|Charm)|\.00|;/g;
const SYSTEM_ID_REGEX = /^\d{5,}$/;

const NAME_REPLACEMENTS = {
    "Material Grabstein (Position #1)": "Material Grabstein (primär)",
    "Material Grabstein (Position #2)": "Material Grabstein (sekundär)"
};

const ATTRIBUTE_ORDER = [
    "Grabstein", "Material Grabstein (primär)", "Material Grabstein (sekundär)",
    "Form der Abdeckung", "Abdeckplatte (Position 1)", "Abdeckplatte (Position 2)",
    "Material der Einfassung", "Grabschmuck", "Material der Inschrift (Vorname)",
    "Inschrift Vorname", "Material der Inschrift (Nachname)", "Inschrift Nachname",
    "Material der Inschrift (Geburtsdatum)", "Inschrift Geburtsdatum",
    "Material der Inschrift (Sterbedatum)", "Inschrift Sterbedatum"
];

const ORDER_MAP = new Map(ATTRIBUTE_ORDER.map((key, i) => [key, i]));

/**
 * Destag PDF Generation and Utility Service.
 */
window.DestagPDF = {
    /**
     * Builds the structural configuration PDF.
     * @param {Object} data - The internal configuration and asset state object.
     * @param {string} [shortUrl=""] - The optional configuration shortlink.
     * @returns {Promise<Uint8Array>} The PDF file bytes.
     */
    async build(data, shortUrl = "") {
        const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

        const response = await fetch(`${data.cdnBaseUrl}assets/pdftemplate.pdf`);
        const templateBytes = await response.arrayBuffer();

        const pdfDoc = await PDFDocument.load(templateBytes);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const firstPage = pdfDoc.getPages()[0];
        const secondPage = pdfDoc.getPages()[1] || pdfDoc.addPage();
        const { height } = firstPage.getSize();

        const drawText = (p, txt, x, y) => p.drawText(String(txt), { x: x * MM2PT, y: height - (y * MM2PT), size: 10, font, color: rgb(0,0,0) });
        const drawImg = (p, img, x, y, w, h) => p.drawImage(img, { x: x * MM2PT, y: height - ((y + h) * MM2PT), width: w * MM2PT, height: h * MM2PT });

        const img = data.screenshot.startsWith('data:image/jp')
            ? await pdfDoc.embedJpg(data.screenshot)
            : await pdfDoc.embedPng(data.screenshot);

        const timestamp = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

        drawText(firstPage, timestamp, 11, 124);
        drawText(firstPage, data.modelName, 11, 146);
        drawText(firstPage, data.modelSize, 11, 167.5);
        drawText(firstPage, shortUrl || `${data.appBaseUrl}?p=${data.catalogueId}`, 11, 189);
        drawImg(firstPage, img, 97.5, 16, 90, 90);

        const attrs = [];

        for (const attr of data.attributes) {
            let { name, id, selected_value_id, attribute_values, value } = attr;
            if (!name) continue;

            for (const [search, replacement] of Object.entries(NAME_REPLACEMENTS)) {
                name = name.replace(search, replacement);
            }

            let val = data.configAttrMap.get(id)?.attribute_value_name ||
                attribute_values?.find(v => v.id === selected_value_id)?.name ||
                data.activeMaterials[id] ||
                data.activeMaterials[name] ||
                data.configAttrMap.get(id)?.attribute_value?.value ||
                value;

            if (typeof val === 'string') {
                val = val.replace(CLEANUP_REGEX, "").trim();
                if (val.includes("text-silver")) val = "Silber";
                if (val.includes("text-bronze")) val = "Bronze";
            }

            if (SYSTEM_ID_REGEX.test(String(val))) continue;
            if ((val === "Bronze" || val === "Silber") && !name.startsWith("Material")) continue;
            if (!val || INVALID_VALUES.has(String(val)) || INVALID_VALUES.has(name)) continue;

            attrs.push({ name, val });
        }

        const getRank = name => {
            for (const [key, index] of ORDER_MAP) {
                if (name.startsWith(key)) return index;
            }
            return 999;
        };

        attrs.sort((a, b) => getRank(a.name) - getRank(b.name));

        let attrY = 125;
        const printed = new Set();

        for (const { name, val } of attrs) {
            const line = `${name}: ${val}`;
            if (!printed.has(line)) {
                drawText(firstPage, line, 88, attrY);
                printed.add(line);
                attrY += 5.5;
            }
        }

        drawImg(secondPage, img, 31, 33.5, 154, 154);
        drawText(secondPage, data.modelName, 11, 204);

        return pdfDoc.save();
    },

    /**
     * Generates the configuration PDF and triggers a browser download.
     * @param {Object} data - The internal configuration and asset state object.
     * @param {string} [shortUrl=""] - The optional configuration shortlink.
     * @returns {Promise<void>}
     */
    async generate(data, shortUrl = "") {
        try {
            const pdfBytes = await this.build(data, shortUrl);
            const downloadUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));

            const link = Object.assign(document.createElement('a'), {
                href: downloadUrl,
                download: 'Destag-Grabmal-Konfiguration.pdf'
            });

            link.click();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 150);

        } catch (err) {
            console.error("❌ PDF Erstellung fehlgeschlagen:", err);
        }
    },

    /**
     * Uploads the PDF to the PDF service under a client-chosen id (one retry).
     * @param {Uint8Array} pdfBytes - The PDF file bytes.
     * @param {string} serviceUrl - The PDF service endpoint.
     * @param {string} id - The UUID the link was announced with.
     * @returns {Promise<boolean>} Whether the PDF is stored.
     */
    async upload(pdfBytes, serviceUrl, id) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await fetch(`${serviceUrl}?id=${encodeURIComponent(id)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/pdf' },
                    body: pdfBytes
                });
                if (response.ok || response.status === 409) return true;
                if (response.status < 500) return false;
            } catch (err) {
                console.error("❌ PDF-Upload fehlgeschlagen:", err);
            }
        }
        return false;
    }
};