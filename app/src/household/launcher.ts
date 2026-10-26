import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { isTrustedNavigation, serverAddress, profilePartition, permitsOfflineProfile } from "./policy";
import { createHash } from "crypto";
import { PlaybackSync, HouseholdSession } from "./sync";
import { installLocalHousehold } from "./local-controller";

function parseProfile(value: unknown): { profileId: string; token: string; externalId: string | null; type: string | null } {
    if (!value || typeof value !== "object" || !("profileId" in value) || typeof value.profileId !== "string" ||
        !("token" in value) || typeof value.token !== "string" || value.token.length > 200) throw new Error("Invalid profile request");
    const externalId = "externalId" in value && typeof value.externalId === "string" && /^tt\d{4,12}$/.test(value.externalId) ? value.externalId : null;
    const type = "type" in value && (value.type === "movie" || value.type === "series") ? value.type : null;
    profilePartition(value.profileId);
    return { profileId: value.profileId, token: value.token, externalId, type };
}

export function createHouseholdLauncher(open: (id: string, route: string) => Promise<BrowserWindow>, streaming:()=>Promise<void>): BrowserWindow {
    const config = join(app.getPath("userData"), "household-server.txt");
    const vault = join(app.getPath("userData"), "household-session.bin");
    let server = existsSync(config) ? serverAddress(readFileSync(config, "utf8").trim()) : "";
    const launcher = new BrowserWindow({ width: 1440, height: 900, title: "STREMFLIX Household Edition (Development)",
        backgroundColor: "#101318", webPreferences: { preload: join(__dirname, "preload.js"),
            partition: "persist:household-shell", contextIsolation: true, nodeIntegration: false, sandbox: true } });
    launcher.setMenu(null);
    const setupFile = join(__dirname, "connect.html");
    let playbackSync: PlaybackSync | null = null;
    function assertSender(event: Electron.IpcMainInvokeEvent, allowSetup = false) {
        const url = event.senderFrame?.url || "";
        if (event.sender !== launcher.webContents || event.senderFrame !== launcher.webContents.mainFrame ||
            !(server && isTrustedNavigation(url, server)) && !(allowSetup && url.startsWith("file:") && url.endsWith("/connect.html"))) {
            throw new Error("Untrusted Household bridge caller");
        }
    }
    launcher.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    launcher.webContents.on("will-navigate", (event, url) => { if (!server || !isTrustedNavigation(url, server)) event.preventDefault(); });
    session.fromPartition("persist:household-shell").setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ipcMain.handle("household:server", async (event, value: unknown) => {
        assertSender(event, true);
        if (typeof value !== "string") throw new Error("Invalid server address");
        const next = serverAddress(value);
        const result = await fetch(next + "/v1/health", { signal: AbortSignal.timeout(5000), redirect: "error" });
        if (!result.ok) throw new Error("Household service unavailable");
        if (next !== server) {
            rmSync(vault, { force: true });
            await launcher.webContents.session.clearStorageData();
        }
        server = next; writeFileSync(config, server, { mode: 0o600 }); await launcher.loadURL(server);
    });
    ipcMain.handle("household:remember", (event, value: unknown) => {
        assertSender(event);
        if (value === null) { rmSync(vault, { force: true }); return; }
        if (!safeStorage.isEncryptionAvailable()) return;
        if (!value || typeof value !== "object" || !("access_token" in value) || typeof value.access_token !== "string" ||
            !("refresh_token" in value) || typeof value.refresh_token !== "string") throw new Error("Invalid session");
        const encoded = JSON.stringify(value);
        if (encoded.length > 4096) throw new Error("Session too large");
        writeFileSync(vault + ".tmp", safeStorage.encryptString(encoded), { mode: 0o600 }); renameSync(vault + ".tmp", vault);
    });
    ipcMain.handle("household:restore", event => {
        assertSender(event);
        if (!existsSync(vault) || !safeStorage.isEncryptionAvailable()) return null;
        try { return JSON.parse(safeStorage.decryptString(readFileSync(vault))); } catch { return null; }
    });
    ipcMain.handle("household:open-profile", async (event, value: unknown) => {
        assertSender(event);
        const request = parseProfile(value);
        let response: Response | null = null;
        try { response = await fetch(server + "/v1/profiles", {
            headers: { Authorization: `Bearer ${request.token}` }, signal: AbortSignal.timeout(5000), redirect: "error" }); } catch { /* A previously authorized account may work during a Household outage. */ }
        const grantFile=join(app.getPath("userData"),`household-grant-${request.profileId}.bin`);
        const tokenHash=createHash('sha256').update(request.token).digest('hex');
        const offline=!response || response.status>=500;
        if(offline){
            let grant: unknown=null;
            try {grant=JSON.parse(safeStorage.decryptString(readFileSync(grantFile)));} catch { /* No offline authority without an intact OS-protected grant. */ }
            if(!permitsOfflineProfile(grant,request.profileId,server,tokenHash,Date.now()))throw new Error("Reconnect Household to authorize this profile");
        } else {
            if (!response?.ok) {rmSync(grantFile,{force:true});throw new Error("Reconnect to your Household before opening a profile");}
            const profiles: unknown = await response.json();
            if (!Array.isArray(profiles)) throw new Error("Invalid profiles response");
            const profile: unknown = profiles.find((p: unknown) => p && typeof p === "object" && "id" in p && p.id === request.profileId);
            if (!profile || typeof profile !== "object" || !("kid" in profile) || profile.kid !== false) {
                rmSync(grantFile,{force:true});throw new Error("Profile unavailable; kids playback awaits content-policy verification");
            }
        }
        const route = request.externalId && request.type ? `#/detail/${request.type}/${request.externalId}` : "";
        if (playbackSync) await playbackSync.stop();
        // The playback worker has its own scoped Household session. Refresh rotation cannot invalidate the UI session.
        let sessionValue: HouseholdSession;
        if(offline){
            const saved: unknown=JSON.parse(safeStorage.decryptString(readFileSync(join(app.getPath("userData"),`household-sync-${request.profileId}.bin`))));
            if(!saved||typeof saved!=="object"||!("session" in saved)||!saved.session||typeof saved.session!=="object"||!("access_token" in saved.session)||typeof saved.session.access_token!=="string"||!("refresh_token" in saved.session)||typeof saved.session.refresh_token!=="string")throw new Error("Reconnect Household to restore playback sync");
            sessionValue={access_token:saved.session.access_token,refresh_token:saved.session.refresh_token};
        }else{
        const activation = await fetch(server + `/v1/profiles/${request.profileId}/activate`, {method:"POST",
            headers:{Authorization:`Bearer ${request.token}`,"Content-Type":"application/json"},body:JSON.stringify({pin:""}),
            signal:AbortSignal.timeout(5000),redirect:"error"});
        if(!activation.ok)throw new Error("Unlock this profile before playback");
        sessionValue = await activation.json();
        if(!safeStorage.isEncryptionAvailable())throw new Error("OS encryption is required for profile sessions");
        writeFileSync(grantFile,safeStorage.encryptString(JSON.stringify({profileId:request.profileId,server,tokenHash,kid:false,expiresAt:Date.now()+86400000})),{mode:0o600});
        }
        const window = await open(request.profileId, route);
        playbackSync = new PlaybackSync(window,request.profileId,server,sessionValue,app.getPath("userData"));
        window.on('blur',()=>playbackSync?.capture(true).catch(()=>undefined));
        window.on('close',()=>playbackSync?.stop().catch(()=>undefined));
        launcher.hide();
    });
    launcher.webContents.on("did-fail-load", (_event, errorCode, _desc, _url, mainFrame) => {
        if (mainFrame && errorCode !== -3) launcher.loadFile(setupFile);
    });
    const localFile=installLocalHousehold(launcher,open,async()=>{await launcher.loadFile(setupFile);},streaming);
    launcher.loadFile(localFile);
    return launcher;
}
