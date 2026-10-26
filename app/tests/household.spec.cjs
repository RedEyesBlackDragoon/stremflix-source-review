const {test,expect}=require('@playwright/test');
const { _electron: electron }=require('playwright');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

test('real Electron partitions separate cookies and local storage across restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dxbi-isolation-'));
  const fixture=path.join(__dirname,'isolation-main.cjs');
  async function launch(){return electron.launch({args:[fixture,`--user-data-dir=${dir}`],env:{...process.env,ELECTRON_ENABLE_LOGGING:'0'}});}
  let app=await launch();
  try{
    await expect.poll(()=>app.windows().length).toBe(2);
    const [a,b]=app.windows();
    await a.waitForLoadState();await b.waitForLoadState();
    await a.evaluate(()=>localStorage.setItem('synthetic_identity','A'));
    expect(await b.evaluate(()=>localStorage.getItem('synthetic_identity'))).toBeNull();
    const cookies=await app.evaluate(async({session})=>{
      await session.fromPartition('persist:household-11111111-1111-4111-8111-111111111111').cookies.set({url:'https://web.stremio.com',name:'synthetic_identity',value:'A'});
      await session.fromPartition('persist:household-11111111-1111-4111-8111-111111111111').flushStorageData();
      return session.fromPartition('persist:household-22222222-2222-4222-8222-222222222222').cookies.get({url:'https://web.stremio.com'});
    });
    expect(cookies).toEqual([]);
    await a.evaluate(()=>localStorage.setItem('flush','1'));
  }finally{await app.close();}
  app=await launch();
  try{
    await expect.poll(()=>app.windows().length).toBe(2);
    const windows=app.windows();
    await windows[0].waitForLoadState();await windows[1].waitForLoadState();
    expect(await windows[0].evaluate(()=>localStorage.getItem('synthetic_identity'))).toBe('A');
    expect(await windows[1].evaluate(()=>localStorage.getItem('synthetic_identity'))).toBeNull();
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:500});}
});

test('server policy rejects credential URLs and profile IDs cannot become paths',async()=>{
  const policy=require('../dist/household/policy.js');
  expect(policy.profilePartition('11111111-1111-4111-8111-111111111111')).toBe('persist:household-11111111-1111-4111-8111-111111111111');
  expect(()=>policy.profilePartition('../other-account')).toThrow();
  expect(()=>policy.serverAddress('https://user:secret@example.com')).toThrow();
  expect(()=>policy.serverAddress('http://example.com')).toThrow();
  expect(policy.serverAddress('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765');
  const grant={profileId:'a',server:'https://home.example',tokenHash:'synthetic-hash',kid:false,expiresAt:200};
  expect(policy.permitsOfflineProfile(grant,'a','https://home.example','synthetic-hash',100)).toBe(true);
  expect(policy.permitsOfflineProfile(grant,'b','https://home.example','synthetic-hash',100)).toBe(false);
  expect(policy.permitsOfflineProfile(grant,'a','https://other.example','synthetic-hash',100)).toBe(false);
  expect(policy.permitsOfflineProfile(grant,'a','https://home.example','synthetic-hash',300)).toBe(false);
  expect(policy.permitsOfflineProfile({...grant,kid:true},'a','https://home.example','synthetic-hash',100)).toBe(false);
});
