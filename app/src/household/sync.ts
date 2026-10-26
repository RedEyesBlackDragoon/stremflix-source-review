import { BrowserWindow, safeStorage, dialog } from "electron";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";

export type HouseholdSession = {access_token: string; refresh_token: string};
type Sample = {external_id: string; season: number | null; episode: number | null; position: number; duration: number; paused: boolean};
type Queued = Sample & {id: string; occurred: number; playback_session: string; event_type: string};
type State = {session: HouseholdSession; events: Queued[]; stremioIdentity: string | null};

function sample(value: unknown): Sample | null {
    if (!value || typeof value !== "object" || !("external_id" in value) || typeof value.external_id !== "string" || !/^tt\d{4,12}$/.test(value.external_id) ||
        !("position" in value) || typeof value.position !== "number" || !Number.isFinite(value.position) || value.position < 0 ||
        !("duration" in value) || typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 604800 ||
        !("paused" in value) || typeof value.paused !== "boolean") return null;
    const season = "season" in value && typeof value.season === "number" && Number.isInteger(value.season) && value.season >= 0 ? value.season : null;
    const episode = "episode" in value && typeof value.episode === "number" && Number.isInteger(value.episode) && value.episode >= 0 ? value.episode : null;
    return {external_id:value.external_id,position:value.position,duration:value.duration,paused:value.paused,season,episode};
}

export class PlaybackSync {
    private timer: ReturnType<typeof setInterval>;
    private state: State;
    private active: {key: string; session: string; last: Sample} | null = null;
    private inFlight: Promise<void> | null = null;
    private captureChain: Promise<void> = Promise.resolve();
    private stopped = false;
    private readonly file: string;
    constructor(private readonly window: BrowserWindow, private readonly profileId: string, private readonly server: string,
                session: HouseholdSession, dataPath: string) {
        this.file=join(dataPath,`household-sync-${profileId}.bin`);
        this.state={session,events:[],stremioIdentity:null};
        if(safeStorage.isEncryptionAvailable()&&existsSync(this.file)) {
            try { const saved: State=JSON.parse(safeStorage.decryptString(readFileSync(this.file)));this.state.events=saved.events;this.state.stremioIdentity=saved.stremioIdentity; } catch { /* Preserve account separation if the queue cannot be recovered. */ }
        }
        this.persist();
        this.timer=setInterval(()=>{this.capture().catch(()=>undefined).then(()=>this.flush()).catch(()=>undefined);},15000);
    }
    private persist(): void {
        if(!safeStorage.isEncryptionAvailable())throw new Error("OS encryption is required for the durable sync queue");
        writeFileSync(this.file+".tmp",safeStorage.encryptString(JSON.stringify(this.state)),{mode:0o600});renameSync(this.file+".tmp",this.file);
    }
    capture(final=false): Promise<void> {
        this.captureChain=this.captureChain.catch(()=>undefined).then(()=>this.captureNow(final));
        return this.captureChain;
    }
    private async captureNow(final: boolean): Promise<void> {
        if(this.stopped&&!final)return;
        if(this.window.isDestroyed())return;
        const identity: unknown=await this.window.webContents.executeJavaScript("window.__householdAdapter ? window.__householdAdapter.identity() : null");
        if(typeof identity!=="string"||!identity)return;
        if(this.state.stremioIdentity && this.state.stremioIdentity!==identity){
            clearInterval(this.timer);
            await dialog.showMessageBox(this.window,{type:"warning",message:"Reconnect the Stremio account linked to this profile.",detail:"The signed-in account changed. Playback sync is stopped to protect profile separation."});
            this.window.destroy();return;
        }
        if(!this.state.stremioIdentity){
            await this.post(`/v1/profiles/${this.profileId}/stremio-binding`,{stremio_user_id:identity,verification_method:"authenticated_isolated_runtime"});
            this.state.stremioIdentity=identity;this.persist();
        }
        const raw: unknown=await this.window.webContents.executeJavaScript("window.__householdAdapter ? window.__householdAdapter.sample() : null");
        const current=sample(raw);
        if(!current)return;
        const key=`${current.external_id}:${current.season}:${current.episode}`;
        const started=!this.active||this.active.key!==key;
        if(started)this.active={key,session:randomUUID(),last:current};
        if(!this.active)return;
        if(current.paused&&!started&&!final&&this.active.last.paused&&current.position===this.active.last.position)return;
        if(this.state.events.length>=10000)throw new Error("Sync queue full; reconnect Household before continuing sync");
        this.state.events.push({...current,id:randomUUID(),occurred:Date.now()/1000,playback_session:this.active.session,
            event_type:started?"started":final?"background":current.paused?"paused":"heartbeat"});
        this.active.last=current;this.persist();
    }
    private async post(route: string, body: unknown): Promise<unknown> {
        let response=await fetch(this.server+route,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.state.session.access_token}`},
            body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:"error"});
        if(response.status===401){
            const refreshed=await fetch(this.server+"/v1/auth/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh_token:this.state.session.refresh_token}),signal:AbortSignal.timeout(8000),redirect:"error"});
            if(!refreshed.ok)throw new Error("Sync authentication expired");
            const credentials: unknown=await refreshed.json();
            if(!credentials||typeof credentials!=="object"||!("access_token" in credentials)||typeof credentials.access_token!=="string"||!("refresh_token" in credentials)||typeof credentials.refresh_token!=="string")throw new Error("Invalid session response");
            this.state.session={access_token:credentials.access_token,refresh_token:credentials.refresh_token};this.persist();
            response=await fetch(this.server+route,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${credentials.access_token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:"error"});
        }
        if(!response.ok)throw new Error("Sync deferred");return response.json();
    }
    flush(): Promise<void> {
        if(this.inFlight)return this.inFlight;
        this.inFlight=this.drain().finally(()=>{this.inFlight=null;});
        return this.inFlight;
    }
    private async drain(): Promise<void> {
            while(this.state.events.length){
                const first=this.state.events[0];
                const identity=await this.post(`/v1/profiles/${this.profileId}/media/resolve`,{external_id:first.external_id,season:first.season,episode:first.episode});
                if(!identity||typeof identity!=="object"||!("work_id" in identity)||typeof identity.work_id!=="string"||!("episode_id" in identity))throw new Error("Invalid media mapping");
                await this.post('/v1/sync/events',{events:[{id:first.id,profile_id:this.profileId,work_id:identity.work_id,episode_id:identity.episode_id,
                    playback_session:first.playback_session,event_type:first.event_type,occurred:first.occurred,position:first.position,duration:first.duration}]});
                this.state.events.shift();this.persist();
            }
    }
    async stop(): Promise<void> {
        if(this.stopped)return;
        this.stopped=true;clearInterval(this.timer);
        await this.capture(true).catch(()=>undefined);await this.flush().catch(()=>undefined);
    }
}
