/**
 * Base path of this script (e.g. the jsDelivr version folder), so that all
 * includes and assets are loaded from the same release as app.js itself.
 */
const SCRIPT_BASE_URL = document.currentScript?.src?.replace(/[^/]*$/, '')
    || 'https://cdn.jsdelivr.net/gh/avriomarketing/destag-3d-konfigurator@v1.0.10/public/';

/** Edge Functions im Supabase-Projekt avrio-services. */
const SHORTLINK_URL = 'https://sxaflpiqtgwfzkybmwzn.supabase.co/functions/v1/destag-shortlink';
const PDF_SERVICE_URL = 'https://sxaflpiqtgwfzkybmwzn.supabase.co/functions/v1/destag-pdf';

const LINK_PLACEHOLDER = 'Link wird generiert...';

/**
 * How long the redirect after the Typeform submit waits for the PDF upload.
 * If the PDF is still missing then, the PDF service builds a replacement PDF
 * from the data packet sent on click.
 */
const PDF_WAIT_MS = 12000;

/** Messages the Typeform embed uses to redirect the page after the submit. */
const TYPEFORM_REDIRECT_TYPES = new Set(['redirect-after-submit', 'thank-you-screen-redirect']);

/** Upper limit for keepalive requests (browsers allow 64 KiB in flight). */
const KEEPALIVE_MAX_BYTES = 60000;

const SUBMIT_NOTICE_TEXT = 'Ihre Konfiguration wird übermittelt …';

/**
 * Resolves with the given promise, or after `ms` at the latest, so that a
 * hanging Expivi call never blocks revealing the configurator.
 * @param {Promise<*>} promise
 * @param {number} ms
 * @returns {Promise<*>}
 */
const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

/**
 * Webflow integration for Expivi 3D Configurator and Destag features.
 */
class WebflowApp {
    /**
     * Initializes configuration parameters and loader states.
     * @param {Object} [config={}] - Optional custom configuration overrides.
     */
    constructor(config = {}) {
        const urlParams = new URLSearchParams(window.location.search);
        const cleanPath = window.location.pathname.replace(/\/p\/.*$/, '').replace(/\/$/, '');

        const urlId = urlParams.get('p') ?? urlParams.get('q');
        const configId = config.catalogueId;

        this.requiresRedirect = !urlId && !configId;

        this.cfg = {
            viewerContainer: '#viewerContainer',
            optionContainer: '#optionsContainer',
            priceSelectors: '#priceContainer',
            catalogueId: urlId ?? configId ?? '',
            currency: 'EUR',
            locale: 'de',
            token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjQ5NzRjOTk3MjFiNzMyYTBiZGIxOGY0ZmJiODkzMDUxMDdmY2Y3YWZlZTE0NjNiNzQ5NWVkMjcyNWQ3NDNmYjdlOGJiYmZjYTNkMGYyMTJiIn0.eyJhdWQiOiIxIiwianRpIjoiNDk3NGM5OTcyMWI3MzJhMGJkYjE4ZjRmYmI4OTMwNTEwN2ZjZjdhZmVlMTQ2M2I3NDk1ZWQyNzI1ZDc0M2ZiN2U4YmJiZmNhM2QwZjIxMmIiLCJpYXQiOjE1OTcxNDQ4MDksIm5iZiI6MTU5NzE0NDgwOSwiZXhwIjoxOTEyNjc3NjA5LCJzdWIiOiIxMzkxIiwic2NvcGVzIjpbXX0.DB93xYSviw3Pm4f3xA0qZFdp2SHcziyvEkA5wLn2uLan6_HluMSGV39EziPKwkofhZ0q_weFOTThWuqdCV3Md3h5NidNmjcjf_-gax5YhJqC8VWxwOz-g9cn1m7ZEdc5hkfCcMQS6eHKsqwl5qgLzKdjObjn-tiQs7ASHRhIoI3M2yFfYi4q3AQHdEzpSAZMe-kwjcDoNeUaNygx-gJAWZQ8uVhYY_AfYX3HhqayaUI4tjErGhpw2HIe8i68cgzOkMGLx6S_CFIYwa84wO7N6NDFLmMcTJnWUcbcyB7umOx1C3p38mcILI9_9WHSm5CxJkIySPvcq1ZsrjmyOYyvLJpbg5UC_nthlXQIZxoMEJ1uAPTXJ7IR1YTv_nOWpE6U9ny7EWd-eJuvCBhS2P19YodMQEz5tlSytdei42i0p6NRkQTavZHCridDFP8lqL8vNH_rnZ1kTP7fUNDr3GhrTYEeBE2IFWYjkKN0VCpW5yqBBqRWgl-xTZ5CSKp-l50tGg_as8iXx7tw7dMyI_xOrB476IjhFaUbCNxgE_IqeP7H_LX2AJxfYykyybEFFQI0oxRtN2Qn8yA2U3GuRY_QeIsf64qY08aNy8kllcKYnvHzNtAEFztfG4qUkleVIGatscJOnMIZM7gCVJ7tryDUSUWVw1pDbtLh-MwjB_RKJVY',
            preset: null,
            appBaseUrl: config.appBaseUrl ?? (window.location.origin + cleanPath),
            cdnBaseUrl: config.cdnBaseUrl ?? SCRIPT_BASE_URL,
            shortlinkUrl: config.shortlinkUrl ?? SHORTLINK_URL,
            pdfServiceUrl: config.pdfServiceUrl ?? PDF_SERVICE_URL,
            ...config
        };

        this.cfg.customCssUrl = config.customCssUrl ?? `${this.cfg.cdnBaseUrl}app.css`;

        /** Script loads started by loadJS, one promise per src. */
        this.scriptLoads = new Map();
        /** The PDF of the currently open request: { id, step, start, done, submitted, result }. */
        this.pdfJob = null;
        this.redirecting = false;

        this.createAndInjectLoader();
    }

    /**
     * Executes orchestration of asset loading and core components.
     * @returns {Promise<void>}
     */
    async init() {
        if (this.requiresRedirect) {
            window.location.replace('/produkte/urnengraber?3d_equal=ja');
            return;
        }

        if (!document.querySelector(this.cfg.viewerContainer)) {
            console.warn('Viewer container is missing.');
            return;
        }

        this.injectGlobalStyles();

        this.loadCSS('https://assets.expivi.net/options/latest/css/app.css');
        if (this.cfg.customCssUrl) this.loadCSS(this.cfg.customCssUrl);

        await this.loadJS('https://assets.expivi.net/viewer/latest/viewer.js');
        await this.loadJS('https://assets.expivi.net/options/latest/js/app.js');
        await this.loadJS('https://embed.typeform.com/next/embed.js');

        this.expiviInstance = new window.ExpiviComponent.default(this.cfg);

        await this.ensureExpiviReady();

        this.initCustomFeatures();
    }

    /**
     * Resolves a Promise when the global Expivi instance becomes accessible.
     * Synchronized directly with the browser's native refresh loop.
     * @returns {Promise<void>}
     */
    ensureExpiviReady() {
        return new Promise(resolve => {
            const check = () => {
                if (window.expivi && typeof window.expivi.setProductAttribute === 'function') {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            requestAnimationFrame(check);
        });
    }

    /**
     * Creates a visual loader wrapper element using native DOM methods.
     * Runs immediately if the DOM is already parsed (e.g. when constructed
     * inside a DOMContentLoaded handler), otherwise waits for it.
     */
    createAndInjectLoader() {
        const inject = () => {
            const expiviContainer = document.querySelector('.expivi');
            if (!expiviContainer) return;

            const parent = expiviContainer.parentNode;
            if (window.getComputedStyle(parent).position === 'static') {
                parent.style.position = 'relative';
            }

            this.loaderEl = document.createElement('div');
            this.loaderEl.id = 'configLoader';

            const spinner = document.createElement('div');
            spinner.className = 'expivi-spinner';
            this.loaderEl.appendChild(spinner);

            parent.insertBefore(this.loaderEl, expiviContainer);
        };

        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', inject);
        } else {
            inject();
        }
    }

    /**
     * Keeps the loader visible until the scene has loaded, the configuration
     * from the URL has been applied and verified and the dynamic headline is
     * resolved. Applying earlier lets Expivi overwrite the values with the
     * product defaults.
     */
    async setupLoaderAndConfigActivation() {
        const expiviContainer = document.querySelector('.expivi');

        await this.waitForSceneLoaded();
        await withTimeout(this.setConfigurationFromUrl(), 4000);
        await withTimeout(this.reapplyMissingConfiguration(), 4000);
        await withTimeout(this.renderTextAttributes(), 4000);

        await this.setupDynamicHeadline();

        await new Promise(resolve => setTimeout(resolve, 600));

        if (this.loaderEl) {
            this.loaderEl.style.opacity = '0';
            setTimeout(() => this.loaderEl?.remove(), 400);
        }

        if (expiviContainer) {
            expiviContainer.style.opacity = '1';
        }
    }

    /**
     * Injects global structural stylesheet overrides.
     */
    injectGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = '[data-form-id] iframe { width: 100% !important; height: 100% !important; min-height: 100% !important; }'
            + ' .destag-submit-notice { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center;'
            + ' padding: 1.5rem; text-align: center; background: rgba(255, 255, 255, 0.94); color: #1a1a1a; font: inherit; }';
        document.head.appendChild(style);
    }

    /**
     * Applies configuration parameters from URL to the Expivi instance.
     * @returns {Promise<Array>} Settles once all parameters have been applied.
     */
    setConfigurationFromUrl() {
        const params = Object.fromEntries(new URLSearchParams(window.location.search));
        delete params.q;
        delete params.p;

        const pending = [];

        for (const [key, val] of Object.entries(params)) {
            if (!val || val === 'undefined' || val === 'null') continue;

            try {
                const id = key.substring(1);
                let result;
                if (key.startsWith('m')) {
                    result = window.expivi.setActiveMaterial(id, val);
                } else if (key.startsWith('a')) {
                    result = window.expivi.setProductAttribute(id, val);
                }
                pending.push(Promise.resolve(result).catch(err => console.warn(`Parameter ${key} ignored:`, err)));
            } catch (err) {
                console.warn(`Parameter ${key} ignored:`, err);
            }
        }

        return Promise.allSettled(pending);
    }

    /**
     * Reads back every material and option from the URL and sets the ones
     * Expivi did not take over a second time. Inscriptions are handled by
     * renderTextAttributes().
     * @returns {Promise<Array>} Settles once all corrections have been applied.
     */
    async reapplyMissingConfiguration() {
        const pending = [];

        for (const [key, val] of new URLSearchParams(window.location.search)) {
            if (!/^[ma]\d+$/.test(key) || !val || val === 'undefined' || val === 'null') continue;

            const id = key.substring(1);
            try {
                if (key.startsWith('m')) {
                    if (String(await window.expivi.getActiveMaterial(id)) !== val) {
                        pending.push(Promise.resolve(window.expivi.setActiveMaterial(id, val)));
                    }
                } else if (/^\d+$/.test(val)) {
                    const attr = await window.expivi.getAttributeById(id);
                    if (String(attr?.selected_value_id) !== val) {
                        pending.push(Promise.resolve(window.expivi.setProductAttribute(id, val)));
                    }
                }
            } catch (err) {
                console.warn(`Parameter ${key} not verified:`, err);
            }
        }

        return Promise.allSettled(pending);
    }

    /**
     * Expivi renders inscriptions (text_to_image attributes) only once their
     * option step has been opened, because the Vuetify expansion panels mount
     * their content lazily. Until then the model shows blank plates.
     * Opens and closes each affected step once, then restores the panels
     * that were open before and sets the inscriptions from the URL again.
     * @returns {Promise<void>}
     */
    async renderTextAttributes() {
        try {
            const attributes = await window.expivi.getProductAttributes();
            const textAttributes = (attributes ?? []).filter(attr => attr.type === 'text_to_image');
            const stepIds = [...new Set(textAttributes.map(attr => attr.parent_id))];

            if (!stepIds.length) return;

            const waitFor = async (check, ms = 3000) => {
                const start = performance.now();
                while (performance.now() - start < ms) {
                    const result = check();
                    if (result) return result;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                return null;
            };

            const panels = (await Promise.all(stepIds.map(id =>
                waitFor(() => document.getElementById(`expansion_panel_view_${id}`))
            ))).filter(panel => panel && !panel.querySelector('.v-expansion-panel-content'));

            if (panels.length) {
                const openPanels = [...document.querySelectorAll('.v-expansion-panel--active')];

                for (const panel of panels) {
                    const header = panel.querySelector('.v-expansion-panel-header');
                    if (!header) continue;

                    header.click();
                    await waitFor(() => panel.querySelector('.v-expansion-panel-content'));
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    header.click();
                }

                for (const panel of openPanels) {
                    if (!panel.classList.contains('v-expansion-panel--active')) {
                        panel.querySelector('.v-expansion-panel-header')?.click();
                    }
                }
            }

            await this.reapplyTextAttributes(textAttributes.map(attr => String(attr.id)));
        } catch (err) {
            console.warn('Inschriften konnten nicht vorab gerendert werden:', err);
        }
    }

    /**
     * Resolves once Expivi has reported the product as ready (onReady is a
     * replay subject, so a late subscription still fires) and no further
     * assets such as meshes or textures have been requested for a second.
     * @param {number} [maxMs=15000] - Upper bound, so it never hangs.
     * @returns {Promise<void>}
     */
    async waitForSceneLoaded(maxMs = 15000) {
        const start = performance.now();
        let onReady = window.expivi?._events?.onReady;

        while (typeof onReady?.subscribe !== 'function' && performance.now() - start < maxMs) {
            await new Promise(resolve => setTimeout(resolve, 100));
            onReady = window.expivi?._events?.onReady;
        }

        if (typeof onReady?.subscribe === 'function') {
            await withTimeout(new Promise(resolve => {
                const sub = onReady.subscribe(() => {
                    resolve();
                    setTimeout(() => sub.unsubscribe());
                });
            }), maxMs);
        }

        let lastRequest = performance.now();
        const observer = new PerformanceObserver(() => { lastRequest = performance.now(); });
        observer.observe({ type: 'resource' });

        while (performance.now() - lastRequest < 1000 && performance.now() - start < maxMs) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        observer.disconnect();
    }

    /**
     * Sets the inscriptions from the URL a second time. Expivi only draws a
     * text_to_image attribute when its value is set after the step has been
     * mounted and the scene has finished loading; values applied earlier stay
     * blank plates.
     * @param {string[]} textIds - Ids of the text_to_image attributes.
     * @returns {Promise<Array>} Settles once all inscriptions have been set.
     */
    reapplyTextAttributes(textIds) {
        const params = new URLSearchParams(window.location.search);

        const pending = textIds
            .map(id => [id, params.get(`a${id}`)])
            .filter(([, val]) => val && val !== 'undefined' && val !== 'null')
            .map(([id, val]) => Promise.resolve(window.expivi.setProductAttribute(id, val))
                .catch(err => console.warn(`Inschrift a${id} ignored:`, err)));

        return Promise.allSettled(pending);
    }

    /**
     * Loads a script once. Every caller gets the same promise, which only resolves
     * after the script has run, so a second click while a script is still loading
     * waits for it. A failed load removes its tag and is forgotten, so it can be
     * tried again. Script tags that were already in the page count as loaded.
     * @param {string} src - Absolute script url.
     * @returns {Promise<void>}
     */
    loadJS(src) {
        if (this.scriptLoads.has(src)) return this.scriptLoads.get(src);
        if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();

        const load = new Promise((res, rej) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => res();
            script.onerror = () => {
                script.remove();
                this.scriptLoads.delete(src);
                rej(new Error(`Skript nicht geladen: ${src}`));
            };
            document.head.append(script);
        });

        this.scriptLoads.set(src, load);
        return load;
    }

    /**
     * loadJS with further attempts after a short pause (flaky mobile networks).
     * @param {string} src - Absolute script url.
     * @param {number} [attempts=2]
     * @returns {Promise<void>}
     */
    async loadJSWithRetry(src, attempts = 2) {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.loadJS(src);
            } catch (err) {
                if (attempt >= attempts) throw err;
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
    }

    /**
     * Scripts every feature (link, share, request, PDF) needs.
     * @returns {Promise<void>}
     */
    async loadFeatureScripts() {
        await Promise.all([
            this.loadJSWithRetry(`${this.cfg.cdnBaseUrl}includes/data.js`),
            this.loadJSWithRetry(`${this.cfg.cdnBaseUrl}includes/link-converter.js`)
        ]);
    }

    /**
     * pdf-lib and the PDF builder.
     * @returns {Promise<void>}
     */
    async loadPdfLibs() {
        await Promise.all([
            this.loadJSWithRetry(`${this.cfg.cdnBaseUrl}assets/dist/pdf-lib.min.js`),
            this.loadJSWithRetry(`${this.cfg.cdnBaseUrl}includes/generate-pdf.js`)
        ]);
    }

    /**
     * Loads the request and PDF tools (about 600 KB) in the background once the
     * scene is up, so that a click on "Modell anfragen" no longer has to wait
     * for them, above all on mobile connections.
     */
    preloadPdfTools() {
        if (!document.querySelector('[data-form-id]') && !document.getElementById('downloadPDF')) return;

        const start = () => {
            this.loadFeatureScripts().catch(err => console.warn('Konfigurator-Skripte nicht vorgeladen:', err));
            this.loadPdfLibs()
                .then(() => window.DestagPDF.loadTemplate(this.cfg.cdnBaseUrl))
                .catch(err => console.warn('PDF-Werkzeuge nicht vorgeladen:', err));
        };

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(start, { timeout: 3000 });
        } else {
            setTimeout(start, 1000);
        }
    }

    /**
     * Helper mapping for absolute style link injections.
     * @param {string} href - Absolute path layout location.
     */
    loadCSS(href) {
        if (!document.querySelector(`link[href="${href}"]`)) {
            document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
        }
    }

    /**
     * Cascades orchestration maps into localized individual features.
     */
    initCustomFeatures() {
        this.setupLoaderAndConfigActivation()
            .catch(err => console.warn('Konfiguration nicht vollständig angewendet:', err))
            .finally(() => this.preloadPdfTools());
        this.setupCenterModel();
        this.setupTypeformRedirect();
        this.setupPdfLeaveReport();
        this.setupDynamicTypeforms();
        this.setupWhatsAppShare();
        this.setupMailShare();
        this.setupPdfDownload();
        this.setupShareLink();
        this.setupClipboard();
    }

    /**
     * Resolves structural configuration properties to safely overwrite DOM title scopes.
     * @returns {Promise<void>}
     */
    async setupDynamicHeadline() {
        if (!window.location.href.toLowerCase().includes('urne')) return;

        try {
            const { expiviData } = await this.getFeatureData(false);
            const modelName = expiviData?.modelName ?? expiviData?.modelAttrs?.name ?? "";

            if (modelName) {
                const headlineEl = document.getElementById('configTitel');
                if (headlineEl) headlineEl.textContent = `Modell ${modelName}`;
            }
        } catch (err) {
            console.warn('Ereignisbasierte Headline-Aktualisierung übersprungen:', err);
        }
    }

    /**
     * Intercepts scene camera bounds to fetch active context screenshots.
     */
    setupCenterModel() {
        document.getElementById('centerModel')?.addEventListener('click', () => {
            window.expivi.getScreenshot().catch(console.error);
        });
    }

    /**
     * Loads external feature scripts, fetches required data, and updates the URL text field.
     * Secures execution order by separating synchronous core assets from asynchronous libs.
     * @param {boolean} [requirePdfLibs=false] - Optional dependency flag for rendering tools.
     * @returns {Promise<Object>} Formatted dataset extraction containing asset contexts and paths.
     */
    async getFeatureData(requirePdfLibs = false) {
        await this.loadFeatureScripts();

        if (requirePdfLibs) {
            await this.loadPdfLibs();
        }

        const expiviData = await window.DestagData.fetchAll(this.cfg);
        const shortUrl = await window.DestagLink.getShortUrl({ ...expiviData, shortlinkUrl: this.cfg.shortlinkUrl });

        const urlField = document.getElementById('textfieldUrl');
        if (urlField) {
            urlField.value = shortUrl;
        }

        return { expiviData, shortUrl };
    }

    /**
     * Renders a physical contextual Typeform container using standard layout metrics.
     * @param {string} shortUrl - Configured routing shortlink parameters.
     * @param {HTMLElement} container - Selected node attachment context.
     * @param {string} formId - Target service configuration string.
     * @param {string} [pdfLink] - Link to the uploaded configuration PDF.
     * @returns {Promise<void>}
     */
    async initTypeform(shortUrl, container, formId, pdfLink = '') {
        if (!container) return;

        // Optional "loading" message behind the embed, hidden once Typeform is ready.
        const loaders = document.querySelectorAll(`[data-form-loading="${formId}"]`);
        loaders.forEach(el => { el.style.display = ''; });

        container.innerHTML = '';
        window.tf.createWidget(formId, {
            container: container,
            hidden: pdfLink ? { config_link: shortUrl, config_pdf: pdfLink } : { config_link: shortUrl },
            width: '100%',
            height: '100%',
            onReady: () => loaders.forEach(el => { el.style.display = 'none'; }),
            onSubmit: () => {
                if (this.pdfJob) this.pdfJob.submitted = true;
            }
        });
    }

    /**
     * Announces a link to the configuration PDF right away and builds and uploads
     * the PDF in the background, so the Typeform request can carry the link without
     * waiting. Also sends a small data packet at once, from which the PDF service
     * builds a replacement PDF if the real one never arrives.
     * @param {Object} expiviData - Data bundle from getFeatureData.
     * @param {string} shortUrl - The configuration shortlink printed into the PDF.
     * @returns {string} The PDF link, or '' if uploading is not possible.
     */
    preparePdfLink(expiviData, shortUrl) {
        if (!this.cfg.pdfServiceUrl || !window.crypto?.randomUUID) return '';

        const id = window.crypto.randomUUID();
        const job = { id, step: 'laden', start: Date.now(), done: false, submitted: false };
        this.pdfJob = job;

        this.sendPdfData(id, expiviData, shortUrl);

        job.result = (async () => {
            try {
                await this.loadPdfLibs();

                job.step = 'bauen';
                let pdfBytes;
                try {
                    pdfBytes = await window.DestagPDF.build(expiviData, shortUrl);
                } catch (err) {
                    console.warn('PDF-Erstellung, zweiter Versuch:', err);
                    pdfBytes = await window.DestagPDF.build(expiviData, shortUrl);
                }

                job.step = 'hochladen';
                if (!await window.DestagPDF.upload(pdfBytes, this.cfg.pdfServiceUrl, id)) {
                    throw new Error('Upload fehlgeschlagen');
                }

                job.step = 'fertig';
                return true;
            } catch (err) {
                console.error('PDF für die Anfrage fehlgeschlagen:', err);
                this.reportPdfProblem(job, err);
                return false;
            } finally {
                job.done = true;
            }
        })();

        return `${this.cfg.pdfServiceUrl}?id=${id}`;
    }

    /**
     * Sends the data the PDF service needs for a replacement PDF: model, size,
     * link, the "Ihre Auswahl" lines and a small preview image. Kept below the
     * keepalive limit, so it still arrives if the page is left right away.
     * @param {string} id - The PDF id.
     * @param {Object} expiviData - Data bundle from getFeatureData.
     * @param {string} shortUrl - The configuration shortlink.
     * @returns {Promise<void>}
     */
    async sendPdfData(id, expiviData, shortUrl) {
        try {
            const packet = {
                zeit: new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
                modell: expiviData.modelName ?? '',
                groesse: expiviData.modelSize ?? '',
                link: shortUrl || `${expiviData.appBaseUrl}?p=${expiviData.catalogueId}`,
                zeilen: window.DestagData.pdfLines(expiviData),
                vorlage: `${this.cfg.cdnBaseUrl}assets/pdftemplate.pdf`
            };

            let body = JSON.stringify(packet);
            for (const size of [480, 320]) {
                const image = await this.shrinkScreenshot(expiviData.screenshot, size);
                if (!image) break;
                const withImage = JSON.stringify({ ...packet, bild: image });
                if (new Blob([withImage]).size <= KEEPALIVE_MAX_BYTES) {
                    body = withImage;
                    break;
                }
            }

            const response = await fetch(`${this.cfg.pdfServiceUrl}?aktion=daten&id=${encodeURIComponent(id)}`, {
                method: 'POST',
                body,
                keepalive: new Blob([body]).size <= KEEPALIVE_MAX_BYTES
            });
            if (!response.ok && response.status !== 409) throw new Error(`Datenpaket HTTP ${response.status}`);
        } catch (err) {
            console.warn('Daten für das Ersatz-PDF nicht gesendet:', err);
            this.reportPdfProblem({ id, step: 'daten', start: Date.now() }, err);
        }
    }

    /**
     * Scales the screenshot down to a small JPEG for the data packet.
     * @param {string} dataUrl - Screenshot from Expivi.
     * @param {number} size - Longest side in pixels.
     * @returns {Promise<string>} JPEG data URL, or '' if not possible.
     */
    async shrinkScreenshot(dataUrl, size) {
        try {
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return '';

            const img = new Image();
            img.src = dataUrl;
            await img.decode();

            const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            return canvas.toDataURL('image/jpeg', 0.7);
        } catch (err) {
            console.warn('Vorschaubild nicht verkleinert:', err);
            return '';
        }
    }

    /**
     * Reports a PDF problem to the PDF service (shows up in its function log),
     * so failures on visitors' devices become visible. Diagnostics only: never
     * throws and never blocks.
     * @param {Object} job - { id, step, start, submitted }.
     * @param {*} problem - Error or text.
     * @param {boolean} [viaBeacon=false] - Use sendBeacon (page is being left).
     */
    reportPdfProblem(job, problem, viaBeacon = false) {
        try {
            const body = JSON.stringify({
                schritt: job.step,
                meldung: String(problem?.message ?? problem).slice(0, 300),
                sekunden: Math.round((Date.now() - job.start) / 1000),
                abgeschickt: !!job.submitted,
                browser: navigator.userAgent,
                seite: window.location.pathname
            });
            const url = `${this.cfg.pdfServiceUrl}?aktion=fehler&id=${encodeURIComponent(job.id)}`;

            if (viaBeacon && navigator.sendBeacon?.(url, body)) return;
            fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
        } catch {
            // Nur Diagnose.
        }
    }

    /**
     * Reports when the page is left while the PDF of the open request is not
     * stored yet (e.g. tab closed or app switched right after the submit).
     */
    setupPdfLeaveReport() {
        window.addEventListener('pagehide', () => {
            const job = this.pdfJob;
            if (!job || job.done) return;
            this.reportPdfProblem(job, 'Seite verlassen, bevor das PDF gespeichert war', true);
        });
    }

    /**
     * Takes over the redirect after the Typeform submit (target set in Typeform,
     * e.g. /danke): waits until the PDF of the request is stored, at most
     * PDF_WAIT_MS, and then redirects. Without this the redirect cancels a PDF
     * that is still being built or uploaded. If the embed changes its messages,
     * the listener simply does not match and Typeform redirects as before.
     */
    setupTypeformRedirect() {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object' || !TYPEFORM_REDIRECT_TYPES.has(data.type) || !data.url) return;
            if (data.target && !['_parent', '_top'].includes(data.target)) return;

            let fromTypeform = false;
            try {
                fromTypeform = /(^|\.)typeform\.com$/.test(new URL(event.origin).hostname);
            } catch {
                fromTypeform = false;
            }
            if (!fromTypeform) return;

            // Capture phase on window: runs before the embed's own listener.
            event.stopImmediatePropagation();
            this.redirectAfterPdf(data.url);
        }, true);
    }

    /**
     * Redirects once the PDF of the open request is done (stored or given up),
     * at most after PDF_WAIT_MS. Shows a short notice over the form meanwhile.
     * @param {string} url - Redirect target from Typeform.
     * @returns {Promise<void>}
     */
    async redirectAfterPdf(url) {
        if (this.redirecting) return;
        this.redirecting = true;

        const job = this.pdfJob;
        if (job && !job.done) {
            this.showSubmitNotice();
            await withTimeout(job.result, PDF_WAIT_MS);
        }

        window.location.href = url;
    }

    /**
     * Covers the Typeform with a short notice while the PDF is being finished.
     */
    showSubmitNotice() {
        const container = document.querySelector('[data-form-id]');
        if (!container || container.querySelector('.destag-submit-notice')) return;

        if (window.getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const notice = document.createElement('div');
        notice.className = 'destag-submit-notice';
        notice.setAttribute('role', 'status');
        notice.textContent = SUBMIT_NOTICE_TEXT;
        container.appendChild(notice);
    }

    /**
     * Automatically captures standard datasets to bind listeners across active forms.
     */
    setupDynamicTypeforms() {
        const containers = document.querySelectorAll('[data-form-id]');
        for (const container of containers) {
            const formId = container.getAttribute('data-form-id');
            const triggerSelector = container.getAttribute('data-form-trigger');

            if (!triggerSelector) continue;

            const btn = document.querySelector(triggerSelector);
            if (!btn) continue;

            btn.addEventListener('click', async () => {
                // A second tap while the form is being prepared would start a second
                // PDF under a new id; the modal still opens through its own handler.
                if (btn.dataset.formBusy) return;
                btn.dataset.formBusy = '1';

                const originalTxt = btn.innerText;
                btn.innerText = 'Wird generiert...';

                try {
                    const { expiviData, shortUrl } = await this.getFeatureData(false);
                    const pdfLink = this.preparePdfLink(expiviData, shortUrl);
                    this.initTypeform(shortUrl, container, formId, pdfLink);
                } catch (err) {
                    console.error('Typeform initialization failed:', err);
                } finally {
                    btn.innerText = originalTxt;
                    delete btn.dataset.formBusy;
                }
            });
        }
    }

    /**
     * Maps global properties into specific social app intent locations.
     */
    setupWhatsAppShare() {
        const btn = document.getElementById('shareWhatsapp');
        if (!btn) return;

        btn.addEventListener('click', async (e) => {
            e.preventDefault();

            try {
                const { shortUrl } = await this.getFeatureData(false);
                const text = `Ich habe mit dem Grabmal-Konfigurator von Destag ein Grabmal gestaltet. Unter folgendem Link kannst du es ansehen: ${shortUrl}`;
                window.location.href = `whatsapp://send?text=${encodeURIComponent(text)}`;
            } catch (err) {
                console.error('WhatsApp share failed:', err);
            }
        });
    }

    /**
     * Extracts existing configurations to inject active parameters inside links.
     */
    setupMailShare() {
        const btn = document.getElementById('configShareMail');
        if (!btn) return;

        const mailTemplate = btn.getAttribute('href');
        if (!mailTemplate || !mailTemplate.startsWith('mailto:')) {
            console.warn('Mail share button is missing a valid mailto: href attribute.');
            return;
        }

        btn.addEventListener('click', async (e) => {
            e.preventDefault();

            try {
                const { shortUrl } = await this.getFeatureData(false);
                window.location.href = mailTemplate.replace('CONFIG_LINK', encodeURIComponent(shortUrl));
            } catch (err) {
                console.error('Mail share failed:', err);
            }
        });
    }

    /**
     * Resolves dynamic configurations to pipeline binary outputs to local file drivers.
     */
    setupPdfDownload() { 
        const btn = document.getElementById('downloadPDF');
        if (!btn) return;

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const label = btn.querySelector('#pdfBtnLabel');
            const originalTxt = label.innerText;
            label.innerText = 'PDF wird erstellt...';

            try {
                const { expiviData, shortUrl } = await this.getFeatureData(true);
                await window.DestagPDF.generate(expiviData, shortUrl);
            } catch (err) {
                console.error('PDF generation failed:', err);
            } finally {
                label.innerText = originalTxt;
            }

            console.log("PDF wird erstellt");
        });
    }

    /**
     * Triggers the generation of a shareable shortlink and populates the target input field.
     */
    setupShareLink() {
        const shareBtn = document.getElementById('shareLink');
        const urlField = document.getElementById('textfieldUrl');

        if (!shareBtn || !urlField) return;

        shareBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            urlField.value = LINK_PLACEHOLDER;

            try {
                await this.getFeatureData(false);
            } catch (err) {
                console.error('Share link generation failed:', err);
            } finally { }
        });
    }

    /**
     * Binds native text clipboard write drivers across selected form scopes.
     */
    setupClipboard() {
        const copyBtn = document.querySelector('.btn-copy-link');
        const urlField = document.getElementById('textfieldUrl');

        if (!copyBtn || !urlField) return;

        // Only swap the label text, so an icon inside the button survives.
        const label = copyBtn.querySelector('[data-copy-label]') ?? copyBtn;

        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!urlField.value || urlField.value === LINK_PLACEHOLDER) return;

            try {
                await navigator.clipboard.writeText(urlField.value);
                const originalTxt = label.textContent;
                label.textContent = 'Link erfolgreich kopiert!';
                copyBtn.style.pointerEvents = 'none';

                setTimeout(() => {
                    label.textContent = originalTxt;
                    copyBtn.style.pointerEvents = 'auto';
                }, 3000);
            } catch (err) {
                console.error('Clipboard write failed:', err);
                label.textContent = 'Es ist ein Fehler aufgetreten.';
            }
        });
    }
}

window.WebflowApp = WebflowApp;