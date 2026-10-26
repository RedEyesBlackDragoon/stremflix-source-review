import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { profilePartition } from "./policy";

export type LocalProfile = { id: string; name: string; avatar: string; accountId: string | null };
type LocalState = { version: 1; admin: { salt: string; hash: string } | null; profiles: LocalProfile[]; attempts: number; lockedUntil: number };
type Cipher = { encryptString(value: string): Buffer; decryptString(value: Buffer): string; isEncryptionAvailable(): boolean };
const avatars = ["teal", "plum", "coral", "blue", "gold"];
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function derive(pin: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => scrypt(pin, salt, 32, {N:16384,r:8,p:1,maxmem:64*1024*1024}, (error, key) => error ? reject(error) : resolve(key)));
}
function parse(value: unknown): LocalState {
    if (!object(value) || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 20 ||
        typeof value.attempts !== "number" || typeof value.lockedUntil !== "number") throw new Error("Invalid local profile store");
    let admin: LocalState["admin"] = null;
    if (value.admin !== null) {
        if (!object(value.admin) || typeof value.admin.salt !== "string" || typeof value.admin.hash !== "string") throw new Error("Invalid administrator record");
        admin = {salt:value.admin.salt,hash:value.admin.hash};
    }
    const profiles = value.profiles.map((item: unknown): LocalProfile => {
        if (!object(item) || typeof item.id !== "string" || typeof item.name !== "string" || item.name.length < 1 || item.name.length > 60 ||
            typeof item.avatar !== "string" || !avatars.includes(item.avatar) || !(item.accountId === null || typeof item.accountId === "string")) throw new Error("Invalid local profile");
        profilePartition(item.id);
        return {id:item.id,name:item.name,avatar:item.avatar,accountId:item.accountId};
    });
    return {version:1,admin,profiles,attempts:value.attempts,lockedUntil:value.lockedUntil};
}

export class LocalProfileStore {
    private state: LocalState;
    private adminSession: {token:string;expires:number} | null = null;
    constructor(private readonly file: string, private readonly cipher: Cipher) {
        if (!cipher.isEncryptionAvailable()) throw new Error("Device encryption is required to protect local profiles");
        this.state = existsSync(file) ? parse(JSON.parse(cipher.decryptString(readFileSync(file)))) : {version:1,admin:null,profiles:[],attempts:0,lockedUntil:0};
    }
    private persist(): void {
        writeFileSync(this.file+".tmp",this.cipher.encryptString(JSON.stringify(this.state)),{mode:0o600});renameSync(this.file+".tmp",this.file);
    }
    publicState() {
        return {configured:this.state.admin!==null,platform:"windows",profiles:this.state.profiles.map(p=>({id:p.id,name:p.name,avatar:p.avatar,linked:p.accountId!==null}))};
    }
    private issue(): string {const token=randomBytes(32).toString('hex');this.adminSession={token,expires:Date.now()+5*60000};return token;}
    requireAdmin(token: unknown): void {
        if(typeof token!=="string"||!this.adminSession||this.adminSession.expires<Date.now()||token!==this.adminSession.token)throw new Error("Unlock Admin Settings first");
    }
    async setup(pin: unknown): Promise<string> {
        if(this.state.admin)throw new Error("An administrator is already configured");
        if(typeof pin!=="string"||!/^\d{6,12}$/.test(pin))throw new Error("Use an admin PIN with 6–12 digits");
        const salt=randomBytes(32),hash=await derive(pin,salt);
        if(this.state.admin)throw new Error("An administrator is already configured");
        this.state.admin={salt:salt.toString('base64'),hash:hash.toString('base64')};this.persist();return this.issue();
    }
    async unlock(pin: unknown): Promise<string> {
        if(this.state.lockedUntil>Date.now())throw new Error("Too many attempts. Try again in one minute");
        if(typeof pin!=="string"||pin.length>64||!this.state.admin)throw new Error("Invalid admin PIN");
        this.state.attempts++;if(this.state.attempts>=5)this.state.lockedUntil=Date.now()+60000;this.persist();
        const actual=await derive(pin,Buffer.from(this.state.admin.salt,'base64'));
        const expected=Buffer.from(this.state.admin.hash,'base64');
        if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error("Incorrect admin PIN");
        this.state.attempts=0;this.state.lockedUntil=0;this.persist();return this.issue();
    }
    create(token: unknown, name: unknown, avatar: unknown): LocalProfile {
        this.requireAdmin(token);
        if(typeof name!=="string"||!name.trim()||name.trim().length>60||typeof avatar!=="string"||!avatars.includes(avatar))throw new Error("Choose a name and avatar");
        if(this.state.profiles.length>=20)throw new Error("This device already has 20 profiles");
        const profile={id:randomUUID(),name:name.trim(),avatar,accountId:null};this.state.profiles.push(profile);this.persist();return profile;
    }
    profile(id: unknown): LocalProfile {
        const profile=this.state.profiles.find(p=>p.id===id);if(!profile)throw new Error("Profile not found on this device");return profile;
    }
    bind(id: string, accountId: string): void {
        if(!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId))throw new Error("The Stremio account could not be verified");
        const profile=this.profile(id);
        if(profile.accountId&&profile.accountId!==accountId)throw new Error("Sign in with this profile's original Stremio account");
        if(this.state.profiles.some(p=>p.id!==id&&p.accountId===accountId))throw new Error("This Stremio account is already linked to another profile");
        if(profile.accountId!==accountId){profile.accountId=accountId;this.persist();}
    }
    remove(token: unknown, id: string): void {this.requireAdmin(token);this.profile(id);this.state.profiles=this.state.profiles.filter(p=>p.id!==id);this.persist();}
    resetAccount(token: unknown,id:string): void {this.requireAdmin(token);this.profile(id).accountId=null;this.persist();}
}
