const {app,BrowserWindow}=require('electron');
const {profilePartition}=require('../dist/household/policy');
app.whenReady().then(async()=>{
  for(const id of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){
    const w=new BrowserWindow({show:false,webPreferences:{partition:profilePartition(id),contextIsolation:true,nodeIntegration:false}});
    await w.loadFile(require('node:path').join(__dirname,'isolation.html'));
  }
});
