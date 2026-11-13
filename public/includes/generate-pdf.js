const MM2PT = 2.83465;

/**
 * Destag PDF Generation and Utility Service.
 * Needs includes/data.js (DestagData.pdfLines) and, for build(), pdf-lib (window.PDFLib).
 */
window.DestagPDF = {
    templates: new Map(),

    /**
     * Fetches the PDF template once per URL. A failed fetch is forgotten, so the
     * next call tries again.
     * @param {string} cdnBaseUrl - The release folder of the configurator.
     * @returns {Promise<ArrayBuffer>} The template bytes.
     */
    loadTemplate(cdnBaseUrl) {
        const url = `${cdnBaseUrl}assets/pdftemplate.pdf`;

        if (!this.templates.has(url)) {
            const request = fetch(url).then(response => {
                if (!response.ok) throw new Error(`PDF-Vorlage nicht geladen (HTTP ${response.status})`);
                return response.arrayBuffer();
            });
            request.catch(() => this.templates.delete(url));
            this.templates.set(url, request);
        }

        return this.templates.get(url);
    },

    /**
     * Builds the structural configuration PDF.
     * @param {Object} data - The internal configuration and asset state object.
     * @param {string} [shortUrl=""] - The optional configuration shortlink.
     * @returns {Promise<Uint8Array>} The PDF file bytes.
     */
    async build(data, shortUrl = "") {
        const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

        const templateBytes = await this.loadTemplate(data.cdnBaseUrl);

        const pdfDoc = await PDFDocument.load(templateBytes.slice(0));
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

        let attrY = 125;
        for (const line of window.DestagData.pdfLines(data)) {
            drawText(firstPage, line, 88, attrY);
            attrY += 5.5;
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
