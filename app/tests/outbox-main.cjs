const {app,BrowserWindow}=require('electron');
const {PlaybackSync}=require('../dist/household/sync');
const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',process.env.HOUSEHOLD_TEST_DATA);
const realFetch=global.fetch;
global.fetch=(...args)=>global.householdOffline?Promise.reject(new Error('Synthetic outage')):realFetch(...args);
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{partition:'persist:outbox-synthetic-profile',contextIsolation:true,nodeIntegration:false}});
  await window.loadFile(path.join(__dirname,'isolation.html'));
  await window.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../../shared/stremio-adapter.js'),'utf8'));
  await window.webContents.executeJavaScript(`
    window.syntheticPosition=25;
    window.__householdAdapter=new window.DXBIStremioAdapter({
      core:{getState:async name=>name==='ctx'?{profile:{auth:{key:'synthetic-vendor-key-never-forward',user:{_id:'synthetic-outbox-user'}}}}:
        {metaItem:{type:'Ready',content:{id:'tt9990000'}},selected:{stream:{url:'https://example.invalid/never-forward?token=synthetic-secret'}}},dispatch:()=>{}},
      document:{querySelector:()=>({currentTime:window.syntheticPosition,duration:100,paused:false,readyState:4})}
    });void 0;
  `);
  global.householdFixture={window,sync:null,
    start:session=>{global.householdFixture.sync=new PlaybackSync(window,process.env.HOUSEHOLD_TEST_PROFILE,'http://127.0.0.1:8876',session,app.getPath('userData'));},
  };
}).catch(error=>{global.householdFixtureError=error.message;});
