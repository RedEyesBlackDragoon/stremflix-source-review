import { homedir } from "os";
import { join } from "path";

class Properties {
    public static themeLinkSelector: string = "head > link[rel=stylesheet]";

    private static baseDataPath: string = process.platform === "win32"
        ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
        : process.platform === "darwin"
            ? join(homedir(), "Library", "Application Support")
            : join(homedir(), ".config");

    private static profile = process.argv.find(arg => arg.startsWith('--household-profile='))?.split('=')[1] || '';
    public static enhancedPath = process.env.DXBI_HOUSEHOLD_DATA || join(Properties.baseDataPath, "dxbi-household");

    public static selectProfile(id: string): void { Properties.profile = id; }
    private static get profilePath(): string {
        return Properties.profile ? join(Properties.enhancedPath, "profile-settings", Properties.profile) : Properties.enhancedPath;
    }
    public static get themesPath(): string { return join(Properties.profilePath, "themes"); }
    public static get pluginsPath(): string { return join(Properties.profilePath, "plugins"); }

    // Stremio Enhanced's folder: Stremflix offers to bring your sign-in and settings over from it once
    public static enhancedImportPath = join(Properties.baseDataPath, "stremio-enhanced");
}

export default Properties;
