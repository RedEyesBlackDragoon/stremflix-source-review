import { homedir } from "os";
import { shell, ipcRenderer } from "electron"
import { readFileSync, writeFileSync } from "fs";
import { getLogger } from "../utils/logger";
import { join } from "path";
import { getUpdateModalTemplate } from "../components/update-modal/updateModal";
import { IPC_CHANNELS } from "../constants";
import Helpers from "../utils/Helpers";

const SKIPPED_VERSION_KEY = "dxbi.skippedUpdate";

class Updater {
    private static logger = getLogger("Updater");
    private static versionCache: string | null = null;

    /**
     * Check for updates and show update modal if available
     * @param showNoUpdatePrompt - Whether to show a message if no update is available
     */
    public static async checkForUpdates(showNoUpdatePrompt: boolean): Promise<boolean> {
        try {
            const release = await this.getLatestRelease();
            const latestVersion = release.version;
            const currentVersion = this.getCurrentVersion();
            
            // Only offer a version once its download for this computer is up (the app builds
            // finish a few minutes after the release is published)
            if (Helpers.isNewerVersion(latestVersion, currentVersion) && this.findAsset(release.assets)) {
                // A version the viewer dismissed isn't offered again at startup, only when they check themselves
                if (!showNoUpdatePrompt && this.getSkippedVersion() === latestVersion) {
                    this.logger.info(`Update v${latestVersion} was dismissed; not showing it again.`);
                    return false;
                }
                this.logger.info(`Update available: v${latestVersion} (current: v${currentVersion})`);
                
                const modalsContainer = document.getElementsByClassName("modals-container")[0];
                if (modalsContainer) {
                    modalsContainer.innerHTML = await getUpdateModalTemplate(currentVersion, latestVersion, release.notes);
                    
                    const modal = document.getElementById("updateModalContainer");
                    modal?.querySelectorAll("[data-dismiss]").forEach((el) => {
                        el.addEventListener("click", () => this.skipVersion(latestVersion));
                    });

                    let downloadBtn = document.getElementById("download-update")
                    downloadBtn?.addEventListener("click", () => {
                        this.skipVersion(latestVersion);
                        this.downloadAndExecuteUpdate(downloadBtn as HTMLElement);
                    })
                }
                return true;
            } else if (showNoUpdatePrompt) {
                await this.alert(
                    "info", 
                    "No update available!", 
                    `You're running the latest version (v${currentVersion}).`, 
                    ["OK"]
                );
            }
            return false;
        } catch (error) {
            this.logger.error(`Failed to check for updates: ${(error as Error).message}`);
            if (showNoUpdatePrompt) {
                await this.alert(
                    "error",
                    "Update check failed",
                    "Could not check for updates. Please check your internet connection.",
                    ["OK"]
                );
            }
            return false;
        }
    }

    // Runs in the page (the popup needs it); its alerts go through the main process
    private static alert(type: "info" | "error", title: string, message: string, buttons: string[]): Promise<number> {
        if (typeof document !== "undefined" && ipcRenderer) return ipcRenderer.invoke(IPC_CHANNELS.SHOW_ALERT, type, title, message, buttons);
        return Helpers.showAlert(type, title, message, buttons);
    }

    private static getSkippedVersion(): string | null {
        try { return localStorage.getItem(SKIPPED_VERSION_KEY); } catch { return null; }
    }

    private static skipVersion(version: string): void {
        try { localStorage.setItem(SKIPPED_VERSION_KEY, version); } catch { /* not available */ }
    }

    /**
     * The latest published release: its version, notes and downloads
     */
    public static async getLatestRelease(): Promise<{ version: string, notes: string, assets: { name: string, browser_download_url: string }[] }> {
        throw new Error("Household development builds update through their release artifacts; upstream installers are disabled");
    }

    /**
     * Get the current installed version
     */
    public static getCurrentVersion(): string {
        if (this.versionCache) {
            return this.versionCache;
        }
        
        try {
            this.versionCache = readFileSync(
                join(__dirname, "../", "../", "version"), 
                "utf-8"
            ).trim();
            return this.versionCache;
        } catch (error) {
            this.logger.error(`Failed to read version file: ${(error as Error).message}`);
            return "0.0.0";
        }
    }

    public static async downloadAndExecuteUpdate(btnElement: HTMLElement): Promise<void> {
        try {
            btnElement.innerText = "Finding Download...";
            btnElement.style.pointerEvents = "none";

            const asset = await this.getDownloadUrl();
            if (!asset) {
                throw new Error("Could not find a valid download for your Operating System.");
            }

            this.logger.info(`Downloading update: ${asset.name}...`);
            btnElement.innerText = "Downloading...";
            
            const downloadsPath = join(homedir(), 'Downloads');
            const filePath = join(downloadsPath, asset.name);

            const response = await fetch(asset.url);
            if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
            
            const buffer = Buffer.from(await response.arrayBuffer());
            writeFileSync(filePath, buffer);

            this.logger.info(`Download complete: ${filePath}`);
            btnElement.innerText = "Downloaded!";

            const isSetupOrMac = asset.name.includes("Setup") || asset.name.endsWith(".dmg");

            if (isSetupOrMac) {
                this.logger.info("Installer or DMG detected. Executing/Mounting...");
                shell.openPath(filePath); 
            } else {
                this.logger.info("Non-setup file detected. Highlighting in file explorer...");
                shell.showItemInFolder(filePath); 
            }

        } catch (error) {
            this.logger.error(`Update failed: ${(error as Error).message}`);
            btnElement.innerText = "Download Failed";
            btnElement.style.pointerEvents = "auto";
        }
    }

    private static async getDownloadUrl(): Promise<{ url: string, name: string } | null> {
        try {
            const release = await this.getLatestRelease();
            const targetAsset = this.findAsset(release.assets);
            return targetAsset ? { url: targetAsset.browser_download_url, name: targetAsset.name } : null;
        } catch (error) {
            this.logger.error(`Failed to fetch release assets: ${(error as Error).message}`);
            return null;
        }
    }

    // The download for this computer among a release's files
    private static findAsset(assets: { name: string, browser_download_url: string }[]) {
        const arm = process.arch === "arm64";
        if (process.platform === "win32") {
            return assets.find((a) => a.name.includes("Setup") && a.name.endsWith(".exe"))
                || assets.find((a) => a.name.endsWith(".exe"));
        }
        if (process.platform === "darwin") return assets.find((a) => a.name.includes("arm64") === arm && a.name.endsWith(".dmg"));
        if (process.platform === "linux") return assets.find((a) => a.name.includes("arm64") === arm && a.name.endsWith(".AppImage"));
        return undefined;
    }
}

export default Updater;
