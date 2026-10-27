/**
 * Base path of this script (e.g. the jsDelivr version folder), so that all
 * includes and assets are loaded from the same release as app.js itself.
 */
const SCRIPT_BASE_URL = document.currentScript?.src?.replace(/[^/]*$/, '')
    || 'https://cdn.jsdelivr.net/gh/avriomarketing/destag-3d-konfigurator@v1.0.1/public/';

const SHORTLINK_URL = 'https://tmmqlcutmymtakyhsqyf.supabase.co/functions/v1/destag-shortlink';

const LINK_PLACEHOLDER = 'Link wird generiert...';

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
            ...config
        };

        this.cfg.customCssUrl = config.customCssUrl ?? `${this.cfg.cdnBaseUrl}app.css`;

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
     * Registers reactive lifecycle hooks to toggle component visibility and data sets.
     * Guarantees that the loader remains visible until the dynamic headline is fully resolved.
     * Implements a flat async architecture and optional chaining for DOM safety.
     */
    setupLoaderAndConfigActivation() {
        const expiviContainer = document.querySelector('.expivi');
        let isActivated = false;

        const activateConfigurator = async () => {
            if (isActivated) return;
            isActivated = true;

            await withTimeout(this.setConfigurationFromUrl(), 2000);
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
        };

        const hasExpiviEvent = window.expivi && typeof window.expivi.on === 'function';

        if (hasExpiviEvent) {
            window.expivi.on('onViewerReady', activateConfigurator);
        }

        setTimeout(activateConfigurator, hasExpiviEvent ? 6000 : 2500);
    }

    /**
     * Injects global structural stylesheet overrides.
     */
    injectGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = '[data-form-id] iframe { width: 100% !important; height: 100% !important; min-height: 100% !important; }';
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
     * Expivi renders inscriptions (text_to_image attributes) only once their
     * option step has been opened, because the Vuetify expansion panels mount
     * their content lazily. Until then the model shows blank plates.
     * Opens and closes each affected step once, then restores the panels
     * that were open before.
     * @returns {Promise<void>}
     */
    async renderTextAttributes() {
        try {
            const attributes = await window.expivi.getProductAttributes();
            const stepIds = [...new Set((attributes ?? [])
                .filter(attr => attr.type === 'text_to_image')
                .map(attr => attr.parent_id))];

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

            if (!panels.length) return;

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
        } catch (err) {
            console.warn('Inschriften konnten nicht vorab gerendert werden:', err);
        }
    }

    /**
     * Helper mapping for dynamic asynchronous script registration.
     * @param {string} src - Absolute script url.
     * @returns {Promise<void>}
     */
    loadJS(src) {
        return new Promise((res, rej) => {
            if (document.querySelector(`script[src="${src}"]`)) return res();
            document.head.append(Object.assign(document.createElement('script'), { src, onload: res, onerror: rej }));
        });
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
        this.setupLoaderAndConfigActivation();
        this.setupCenterModel();
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
        await Promise.all([
            this.loadJS(`${this.cfg.cdnBaseUrl}includes/data.js`),
            this.loadJS(`${this.cfg.cdnBaseUrl}includes/link-converter.js`)
        ]);

        if (requirePdfLibs) {
            await this.loadJS(`${this.cfg.cdnBaseUrl}assets/dist/pdf-lib.min.js`);
            await this.loadJS(`${this.cfg.cdnBaseUrl}includes/generate-pdf.js`);
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
     * @returns {Promise<void>}
     */
    async initTypeform(shortUrl, container, formId) {
        if (!container) return;

        container.innerHTML = '';
        window.tf.createWidget(formId, {
            container: container,
            hidden: { config_link: shortUrl },
            width: '100%',
            height: '100%'
        });
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
                const originalTxt = btn.innerText;
                btn.innerText = 'Wird generiert...';

                try {
                    const { shortUrl } = await this.getFeatureData(false);
                    this.initTypeform(shortUrl, container, formId);
                } catch (err) {
                    console.error('Typeform initialization failed:', err);
                } finally {
                    btn.innerText = originalTxt;
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

        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!urlField.value || urlField.value === LINK_PLACEHOLDER) return;

            try {
                await navigator.clipboard.writeText(urlField.value);
                const originalTxt = copyBtn.textContent;
                copyBtn.textContent = 'Link erfolgreich kopiert!';
                copyBtn.style.pointerEvents = 'none';

                setTimeout(() => {
                    copyBtn.textContent = originalTxt;
                    copyBtn.style.pointerEvents = 'auto';
                }, 3000);
            } catch (err) {
                console.error('Clipboard write failed:', err);
                copyBtn.textContent = 'Es ist ein Fehler aufgetreten.';
            }
        });
    }
}

window.WebflowApp = WebflowApp;