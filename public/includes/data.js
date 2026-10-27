const HTML_TAG_REGEX = /<[^>]+>/g;

/**
 * Destag Data Management and API Aggregation Service.
 */
window.DestagData = {
    /**
     * Aggregates all structural and visual 3D asset data concurrently from external APIs.
     * @param {Object} cfg - The shared global application configuration.
     * @param {string} cfg.catalogueId - The catalogue entry ID.
     * @param {string} [cfg.product] - Fallback product identifier.
     * @param {string} cfg.token - The authorization token for the catalogue endpoint.
     * @param {string} cfg.appBaseUrl - Webflow client domain base path.
     * @param {string} cfg.cdnBaseUrl - Asset deployment endpoint path.
     * @returns {Promise<Object>} Aggregated state bundle containing normalized attributes, maps, and screenshot buffers.
     */
    async fetchAll(cfg) {
        try {
            const id = cfg.catalogueId ?? cfg.product;

            const [rawAttrs, savedConfig, materialGroups, screenshot, catalogJson] = await Promise.all([
                window.expivi.getProductAttributes(),
                window.expivi.saveConfiguration(),
                window.expivi.managers.resolveMaterialGroups(),
                window.expivi.getScreenshot(1200, 1200),
                fetch("https://expivi.net/api/catalogue", {
                    headers: { Authorization: `Bearer ${cfg.token}` }
                }).then(res => res.ok ? res.json() : { data: [] })
            ]);

            const modelAttrs = catalogJson.data?.find(item => item.id == id)?.attributes ?? {};
            const modelName = modelAttrs.name ?? "";
            const modelSize = (modelAttrs.description ?? "").replace(HTML_TAG_REGEX, '').trim();

            const activeMaterials = {};
            const materialIds = {};

            const groups = materialGroups ?? [];
            await Promise.all(groups.map(async group => {
                const material = await window.expivi.getActiveMaterial(group.id);
                if (!material) return;

                const isObject = typeof material === 'object' && material !== null;
                const materialId = isObject ? material.id : material;
                const materialName = isObject ? material.name : null;

                if (materialId !== undefined && materialId !== null) {
                    materialIds[group.id] = materialId;
                }

                if (materialName) {
                    activeMaterials[group.id] = materialName;
                    if (group.name) {
                        activeMaterials[group.name] = materialName;
                    }
                }
            }));

            const configAttrs = savedConfig?.configured_products?.[0]?.attributes ?? [];
            const configAttrMap = new Map(configAttrs.map(attr => [attr.attribute_id, attr]));
            const standardizedAttributes = Array.isArray(rawAttrs) ? rawAttrs : Object.values(rawAttrs ?? {});

            return {
                catalogueId: id,
                appBaseUrl: cfg.appBaseUrl,
                cdnBaseUrl: cfg.cdnBaseUrl,
                attributes: standardizedAttributes,
                config: savedConfig,
                configAttrMap,
                activeMaterials,
                materialIds,
                screenshot,
                modelName,
                modelSize
            };

        } catch (err) {
            console.error("❌ Datenfehler in fetchAll:", err);
            throw err;
        }
    }
};