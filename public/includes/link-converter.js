const SHORTLINK_TIMEOUT_MS = 4000;
const SHORTLINK_REGEX = /^https:\/\/[^\s"<>]+$/;

/**
 * Destag Shortlink and URL Conversion Service.
 */
window.DestagLink = {
    /** @type {Map<string, string>} Resolved shortlinks per long URL. */
    cache: new Map(),

    /**
     * Builds the full configuration URL that restores the current state on load.
     * @param {Object} payload - The application configuration and state parameters.
     * @param {string} payload.appBaseUrl - The base URL of the active Webflow page.
     * @param {string} payload.catalogueId - The unique model or catalog identifier.
     * @param {Object} [payload.config] - The optional component configuration layout.
     * @param {Object.<string, string|number>} [payload.materialIds] - The actively selected material options.
     * @returns {string} The long configuration URL.
     */
    buildLongUrl({ appBaseUrl, catalogueId, config, materialIds }) {
        const params = new URLSearchParams();
        if (catalogueId) {
            params.append('p', catalogueId);
        }

        const attributes = config?.configured_products?.[0]?.attributes ?? [];
        for (const { attribute_id, attribute_value } of attributes) {
            const value = attribute_value?.attribute_value_id ?? attribute_value?.value;
            if (value !== undefined && value !== null && value !== '') {
                params.append(`a${attribute_id}`, value);
            }
        }

        if (materialIds) {
            for (const [key, val] of Object.entries(materialIds)) {
                if (!Number.isNaN(Number(key)) && val !== undefined && val !== null) {
                    params.append(`m${key}`, val);
                }
            }
        }

        return `${appBaseUrl}?${params.toString()}`;
    },

    /**
     * Converts a full product configuration state into a shortened Bitly URL.
     * Falls back to the full long URL on network, timeout or service failure.
     * @param {Object} payload - See buildLongUrl, plus:
     * @param {string} payload.shortlinkUrl - The shortlink service endpoint.
     * @returns {Promise<string>} The shortened URL or the long fallback URL.
     */
    async getShortUrl(payload) {
        const longUrl = this.buildLongUrl(payload);

        if (this.cache.has(longUrl)) {
            return this.cache.get(longUrl);
        }

        if (!payload.shortlinkUrl) {
            return longUrl;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SHORTLINK_TIMEOUT_MS);

        try {
            const response = await fetch(payload.shortlinkUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: longUrl }),
                signal: controller.signal
            });

            const data = await response.json();
            const link = typeof data?.link === 'string' ? data.link.trim() : '';

            if (!response.ok || !SHORTLINK_REGEX.test(link)) {
                throw new Error(`Shortlink service error: ${data?.error ?? response.status}`);
            }

            this.cache.set(longUrl, link);
            return link;

        } catch (err) {
            console.error("❌ Link-Konvertierung fehlgeschlagen:", err);
            return longUrl;
        } finally {
            clearTimeout(timeout);
        }
    }
};
