import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from "electron";
import { readFileSync, rmSync } from "fs";
import { join, resolve, sep } from "path";
import { pathToFileURL } from "url";
import { LocalProfileStore } from "./local-store";
import { profilePartition } from "./policy";

export function installLocalHousehold(launcher: BrowserWindow, open: (id:string,route:string)=>Promise<BrowserWindow>, server:()=>Promise<void>, streaming:()=>Promise<void>): string {
    const file=join(__dirname,'local','index.html');
    const url=pathToFileURL(file).href;
    const store=new LocalProfileStore(join(app.getPath('userData'),'local-household.bin'),safeStorage);
    async function clearProfile(id:string): Promise<void> {
        const partition=profilePartition(id),isolated=session.fromPartition(partition);
        for(const window of BrowserWindow.getAllWindows())if(window.webContents.session===isolated)window.destroy();
        await isolated.clearStorageData();await isolated.clearCache();isolated.flushStorageData();
        const base=resolve(app.getPath('userData'),'profile-settings');
        const target=resolve(base,id);
        if(!target.startsWith(base+sep))throw new Error('Invalid profile storage path');
        rmSync(target,{recursive:true,force:true});
    }
    ipcMain.handle('household:local',async(event,method:unknown,value:unknown)=>{
        if(event.sender!==launcher.webContents||event.senderFrame!==launcher.webContents.mainFrame||event.senderFrame?.url!==url)throw new Error('Untrusted local profile caller');
        if(typeof method!=='string'||!value||typeof value!=='object')throw new Error('Invalid local request');
        const token='adminToken' in value?value.adminToken:undefined;
        if(method==='state')return store.publicState();
        if(method==='setup')return {adminToken:await store.setup('pin' in value?value.pin:null)};
        if(method==='unlock')return {adminToken:await store.unlock('pin' in value?value.pin:null)};
        if(method==='create')return store.create(token,'name' in value?value.name:null,'avatar' in value?value.avatar:null);
        if(method==='server'){store.requireAdmin(token);await server();return true;}
        if(method==='streaming'){store.requireAdmin(token);await streaming();return true;}
        if(method==='licenses'){await dialog.showMessageBox(launcher,{title:'Licenses and credits',message:'STREMFLIX Household Edition',detail:readFileSync(join(__dirname,'licenses.txt'),'utf8')});return true;}
        const profile=store.profile('id' in value?value.id:null);
        if(method==='delete'||method==='reset'){
            store.requireAdmin(token);await clearProfile(profile.id);
            if(method==='delete')store.remove(token,profile.id);else store.resetAccount(token,profile.id);
            return true;
        }
        if(method!=='open')throw new Error('Unknown local profile action');
        const window=await open(profile.id,'');
        let checking=false;
        const identityTimer=setInterval(async()=>{
            if(checking||window.isDestroyed())return;checking=true;
            try {
                const identity:unknown=await window.webContents.executeJavaScript('window.__householdAdapter ? window.__householdAdapter.identity() : null');
                if(typeof identity==='string'){
                    try {store.bind(profile.id,identity);}catch(error){
                        window.hide();
                        await window.webContents.executeJavaScript('window.__householdAdapter && window.__householdAdapter.signOut(); void 0;').catch(()=>undefined);
                        await dialog.showMessageBox(launcher,{type:'warning',message:error instanceof Error?error.message:'Reconnect this profile’s Stremio account'});
                        window.destroy();launcher.show();
                    }
                }
            }catch{/* The account surface is still loading. */}finally{checking=false;}
        },1500);
        window.once('closed',()=>clearInterval(identityTimer));
        launcher.hide();return true;
    });
    return file;
}
