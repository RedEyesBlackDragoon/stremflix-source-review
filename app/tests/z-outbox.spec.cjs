const {test,expect}=require('@playwright/test');
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('Windows durable outbox survives restart and keeps profile B unchanged',async({request})=>{
  const login=await request.post('/v1/admin/login',{data:{household_id:'00000000-0000-4000-8000-000000000001',password:'synthetic-ui-password-123'}});
  expect(login.ok()).toBe(true);const owner=await login.json(),headers={Authorization:`Bearer ${owner.access_token}`};
  expect((await request.post('/__test__/catalog',{headers})).ok()).toBe(true);
  const a=await (await request.post('/v1/profiles',{headers,data:{name:'Synthetic Outbox A'}})).json();
  const b=await (await request.post('/v1/profiles',{headers,data:{name:'Synthetic Outbox B'}})).json();
  const session=await (await request.post(`/v1/profiles/${a.id}/activate`,{headers,data:{pin:''}})).json();
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dxbi-outbox-'));
  const fixture=path.join(__dirname,'outbox-main.cjs');
  async function launch(){const app=await electron.launch({args:[fixture],env:{...process.env,HOUSEHOLD_TEST_DATA:dir,HOUSEHOLD_TEST_PROFILE:a.id}});
    await app.firstWindow();await expect.poll(async()=>{const result=await app.evaluate(()=>({ready:!!global.householdFixture,error:global.householdFixtureError}));if(result.error)throw new Error(result.error);return result.ready;}).toBe(true);await app.evaluate((_,session)=>global.householdFixture.start(session),session);return app;}
  let app=await launch();
  try{
    await app.evaluate(async()=>{await global.householdFixture.sync.capture();await global.householdFixture.sync.flush();});
    await app.evaluate(async()=>{global.householdOffline=true;await global.householdFixture.window.webContents.executeJavaScript('window.syntheticPosition=45');await global.householdFixture.sync.capture();await global.householdFixture.sync.flush().catch(()=>{});});
    const state=await request.get(`/v1/sync/changes?profile_id=${a.id}`,{headers});
    expect((await state.json()).items[0].position).toBe(25);
  }finally{await app.close();}
  app=await launch();
  try{
    await app.evaluate(()=>global.householdFixture.sync.flush());
    const aState=await (await request.get(`/v1/sync/changes?profile_id=${a.id}`,{headers})).json();
    const bState=await (await request.get(`/v1/sync/changes?profile_id=${b.id}`,{headers})).json();
    expect(aState.items[0].position).toBe(45);expect(bState.items).toEqual([]);
    await app.evaluate(()=>global.householdFixture.sync.flush());
    const exported=await (await request.get(`/v1/profiles/${a.id}/export`,{headers})).json();
    expect(exported.events).toHaveLength(2);
    expect(JSON.stringify(exported.events)).not.toContain('url');expect(JSON.stringify(exported.events)).not.toContain('synthetic-vendor-key');
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:500});}
});
