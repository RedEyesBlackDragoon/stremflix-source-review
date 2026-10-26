import { app } from "electron";
import { cpSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import Properties from "./Properties";
import Helpers from "../utils/Helpers";
import ExtractMetaData from "../utils/ExtractMetaData";
import { getLogger } from "../utils/logger";

const logger = getLogger("BuiltIn");

export const BUILT_IN_PLUGIN = "dxbi.plugin.js";

/**
 * Stremflix ships inside the app. It's kept in the plugins folder like any other plugin, so the
 * plugin's own update check keeps working between app releases: the bundled copy only replaces
 * an older one.
 */
export function seedBuiltInPlugin(): void {
    // packaged: <app>/static; running from the source tree: the app path is dist/, one level down
    const bundled = [join(app.getAppPath(), "static", BUILT_IN_PLUGIN), join(app.getAppPath(), "..", "static", BUILT_IN_PLUGIN)]
        .find((p) => existsSync(p)) || join(app.getAppPath(), "static", BUILT_IN_PLUGIN);
    const installed = join(Properties.pluginsPath, BUILT_IN_PLUGIN);
    try {
        const content = readFileSync(bundled, "utf-8");
        const bundledVersion = ExtractMetaData.extractMetadataFromText(content)?.version;
        const installedVersion = existsSync(installed)
            ? ExtractMetaData.extractMetadataFromFile(installed)?.version
            : null;
        if (!installedVersion || (bundledVersion && Helpers.isNewerVersion(bundledVersion, installedVersion))) {
            writeFileSync(installed, content, "utf-8");
            logger.info(`Installed the built-in Stremflix plugin v${bundledVersion}.`);
        }
    } catch (err) {
        logger.error("Failed to install the built-in Stremflix plugin: " + (err as Error).message);
    }
}

// What comes over from Stremio Enhanced: the Stremio sign-in, library and app settings (browser
// storage), plugins and themes with their settings, and the streaming server it downloaded
// (not window transparency: Stremflix's look isn't made for a see-through window)
const IMPORT_ITEMS = ["Local Storage", "IndexedDB", "Session Storage", "plugins", "themes", "streamingserver",
    "use_stremio_service_for_streaming", "use_server_js_for_streaming"];

/**
 * First launch only: offer to bring everything over from Stremio Enhanced, so Stremflix opens signed
 * in and set up exactly as before.
 */
export async function offerEnhancedImport(): Promise<void> {
    const from = Properties.enhancedImportPath;
    const to = Properties.enhancedPath;
    const marker = join(to, ".import-offered");
    if (existsSync(marker) || existsSync(join(to, "Local Storage")) || !existsSync(join(from, "Local Storage"))) return;
    writeFileSync(marker, new Date().toISOString());

    // (DXBI_IMPORT=copy|fresh answers for automated tests)
    const preset = process.env.DXBI_IMPORT;
    const choice = preset ? (preset === "copy" ? 0 : 1) : await Helpers.showAlert(
        "question",
        "Bring your Stremio Enhanced setup?",
        "Stremflix found Stremio Enhanced on this computer. It can copy your Stremio sign-in, library, settings, " +
        "plugins and themes over, so everything is just as you left it.\n\n" +
        "Close Stremio Enhanced first if it's open. Stremio Enhanced itself isn't changed.",
        ["Copy my setup", "Start fresh"]
    );
    if (choice !== 0) return;

    for (const item of IMPORT_ITEMS) {
        const src = join(from, item);
        if (!existsSync(src)) continue;
        try {
            cpSync(src, join(to, item), { recursive: true, force: true, errorOnExist: false });
            logger.info(`Imported ${item} from Stremio Enhanced.`);
        } catch (err) {
            logger.warn(`Couldn't import ${item}: ${(err as Error).message}`);
        }
    }
}
