const HTML_TAG_REGEX = /<[^>]+>/g;

/**
 * Destag Data Management and API Aggregation Service.
 */
window.DestagData = (() => {
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

    const getRank = name => {
        for (const [key, index] of ORDER_MAP) {
            if (name.startsWith(key)) return index;
        }
        return 999;
    };

    return {
        /**
         * Screenshot of the grave for the PDF (1200 x 1200 JPEG).
         * Expivi's default screenshot camera frames the whole scene (frameScene),
         * which currently renders the grave tiny and from far away. Rendering from
         * the pose of the scene camera gives the usual, filling view. Falls back to
         * the default screenshot if the camera cannot be read.
         * @returns {Promise<string>} Image data URL.
         */
        async takeScreenshot() {
            try {
                const cam = await window.expivi.getActiveCamera();
                const position = [cam?.position_x, cam?.position_y, cam?.position_z].map(Number);
                const quaternion = [cam?.quaternion_x, cam?.quaternion_y, cam?.quaternion_z, cam?.quaternion_w].map(Number);

                if ([...position, ...quaternion].every(Number.isFinite)) {
                    const shot = await window.expivi.getScreenshot(
                        1200, 1200, 'CUSTOM_CAMERA_POSITION', 'image/jpeg', { position, quaternion }
                    );
                    if (typeof shot === 'string' && shot.startsWith('data:image/')) return shot;
                }
            } catch (err) {
                console.warn('Screenshot aus der Kameraposition nicht möglich:', err);
            }

            return window.expivi.getScreenshot(1200, 1200);
        },

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
                    this.takeScreenshot(),
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
        },

        /**
         * Builds the "Ihre Auswahl" lines of the configuration PDF ("Name: Wert"),
         * sorted and without duplicates. Used by the PDF in the browser and by the
         * data packet the PDF service builds a replacement PDF from.
         * @param {Object} data - Data bundle from fetchAll.
         * @returns {string[]} The lines in print order.
         */
        pdfLines(data) {
            const attrs = [];

            for (const attr of data.attributes ?? []) {
                let { name, id, selected_value_id, attribute_values, value } = attr;
                if (!name) continue;

                for (const [search, replacement] of Object.entries(NAME_REPLACEMENTS)) {
                    name = name.replace(search, replacement);
                }

                let val = data.configAttrMap?.get(id)?.attribute_value_name ||
                    attribute_values?.find(v => v.id === selected_value_id)?.name ||
                    data.activeMaterials?.[id] ||
                    data.activeMaterials?.[name] ||
                    data.configAttrMap?.get(id)?.attribute_value?.value ||
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

            attrs.sort((a, b) => getRank(a.name) - getRank(b.name));

            return [...new Set(attrs.map(({ name, val }) => `${name}: ${val}`))];
        }
    };
})();
