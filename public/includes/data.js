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
         * Camera pose that frames the grave itself, seen from the direction the
         * visitor is currently looking from.
         * Expivi frames the camera on the bounding box of the whole product. The
         * products contain a flat ground plane of 5 x 5 m, so that framing shows
         * the grave tiny. Here flat parts much wider than the grave are left out.
         * @returns {Promise<Object|null>} { center, position, direction } as [x, y, z], or null.
         */
        async fitPose() {
            const [root] = (await window.expivi.resolveProductNodes()) ?? [];
            if (!root) return null;

            const childrenOf = node => node.children ?? node.mChildren
                ?? (typeof node.getChildren === 'function' ? node.getChildren() : null) ?? [];
            const boxes = [];
            const collect = node => {
                const children = childrenOf(node);
                if (!children.length) {
                    const box = node.getBoundingBox?.(true);
                    if (box && !box.isEmpty?.()) boxes.push(box);
                }
                children.forEach(collect);
            };
            collect(root);

            const union = list => list.reduce((acc, b) => ({
                min: [Math.min(acc.min[0], b.min.x), Math.min(acc.min[1], b.min.y), Math.min(acc.min[2], b.min.z)],
                max: [Math.max(acc.max[0], b.max.x), Math.max(acc.max[1], b.max.y), Math.max(acc.max[2], b.max.z)]
            }), { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
            const height = b => b.max.y - b.min.y;
            const width = b => Math.max(b.max.x - b.min.x, b.max.z - b.min.z);

            const solid = boxes.filter(b => height(b) > 1);
            if (!solid.length) return null;
            const core = union(solid);
            const coreWidth = Math.max(core.max[0] - core.min[0], core.max[2] - core.min[2]);
            const grave = union(boxes.filter(b => height(b) > 1 || width(b) <= coreWidth * 1.5));

            const center = grave.min.map((v, i) => (v + grave.max[i]) / 2);
            const radius = Math.hypot(...grave.max.map((v, i) => v - grave.min[i])) / 2;
            if (![...center, radius].every(Number.isFinite) || radius <= 0) return null;

            // Direction from the grave to the camera, at least 15° from above.
            const live = await window.expivi.getCameraTransform();
            let direction = [live.position.x - center[0], live.position.y - center[1], live.position.z - center[2]];
            let length = Math.hypot(...direction);
            if (!Number.isFinite(length) || length === 0) direction = [0.55, 0.36, 0.75];
            else direction = direction.map(v => v / length);

            const minUp = Math.sin(15 * Math.PI / 180);
            if (direction[1] < minUp) {
                const flat = Math.hypot(direction[0], direction[2]) || 1;
                const scale = Math.cos(15 * Math.PI / 180) / flat;
                direction = [direction[0] * scale, minUp, direction[2] * scale];
            }
            length = Math.hypot(...direction);
            direction = direction.map(v => v / length);

            const camera = await window.expivi.getActiveCamera();
            const fov = (Number(camera?.properties?.fov) || 45) * Math.PI / 180;
            const distance = radius / Math.sin(fov / 2);

            return {
                center,
                position: center.map((v, i) => v + direction[i] * distance),
                direction
            };
        },

        /**
         * Screenshot of the grave for the PDF (1200 x 1200 JPEG), framed on the
         * grave itself (see fitPose). Expivi restores the visitor's view afterwards.
         * Falls back to Expivi's default screenshot if the grave cannot be measured.
         * @returns {Promise<string>} Image data URL.
         */
        async takeScreenshot() {
            try {
                const pose = await this.fitPose();
                if (pose) {
                    const shot = await window.expivi.getScreenshot(
                        1200, 1200, 'CUSTOM_CAMERA_POSITION', 'image/jpeg',
                        { position: pose.position, direction: pose.direction }
                    );
                    if (typeof shot === 'string' && shot.startsWith('data:image/')) return shot;
                }
            } catch (err) {
                console.warn('Screenshot mit eingepasster Kamera nicht möglich:', err);
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

                // saveConfiguration() would render its own thumbnail with Expivi's
                // default camera. Running that alongside the PDF screenshot lets Expivi
                // restore the wrong view afterwards, so the viewer jumps far away.
                // A size of 0 x 0 skips the thumbnail; the screenshot runs on its own.
                const [rawAttrs, savedConfig, materialGroups, catalogJson] = await Promise.all([
                    window.expivi.getProductAttributes(),
                    window.expivi.saveConfiguration(0, 0),
                    window.expivi.managers.resolveMaterialGroups(),
                    fetch("https://expivi.net/api/catalogue", {
                        headers: { Authorization: `Bearer ${cfg.token}` }
                    }).then(res => res.ok ? res.json() : { data: [] })
                ]);
                const screenshot = await this.takeScreenshot();

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
