const {test,expect}=require('@playwright/test');
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('local setup, restart, profile opening, and isolated session deletion need no backend',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dxbi-local-app-'));
  const launch=()=>electron.launch({args:[path.resolve(__dirname,'../dist/main.js'),'--no-stremio-server'],env:{...process.env,DXBI_HOUSEHOLD_DATA:dir}});
  let app=await launch(),ids;
  try{
    const page=await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Welcome home.'})).toBeVisible();
    await page.getByLabel('Create admin PIN (6–12 digits)').fill('314159');await page.getByLabel('Confirm admin PIN').fill('314159');
    await page.getByRole('button',{name:'Set Up This Device'}).click();
    await page.getByLabel('Viewer name').fill('Synthetic Local A');await page.getByRole('button',{name:'Create Profile',exact:true}).click();
    await expect(page.getByRole('heading',{name:"Who's watching?"})).toBeVisible();
    ids=await page.evaluate(async()=>{const s=await LocalHousehold.call('state',{});return s.profiles.map(p=>p.id);});
    await page.screenshot({path:'../docs/household/local-desktop-picker.png'});
  }finally{await app.close();}
  app=await launch();
  try{
    const page=await app.firstWindow();await expect(page.getByRole('button',{name:'Synthetic Local A',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Admin Settings',exact:true}).click();
    await page.getByLabel('Admin PIN',{exact:true}).fill('000000');await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Incorrect admin PIN');
    await page.getByLabel('Admin PIN',{exact:true}).fill('314159');await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByRole('button',{name:'Add Profile',exact:true}).click();await page.getByLabel('Viewer name').fill('Synthetic Local B');await page.getByRole('button',{name:'Create Profile',exact:true}).click();
    const profiles=await page.evaluate(()=>LocalHousehold.call('state',{}));expect(profiles.profiles[0].id).toBe(ids[0]);const [a,b]=profiles.profiles;
    await app.evaluate(async({session},{a,b})=>{
      const first=session.fromPartition(`persist:household-${a.id}`),second=session.fromPartition(`persist:household-${b.id}`);
      await first.cookies.set({url:'https://web.stremio.com',name:'synthetic_identity',value:'A'});await second.cookies.set({url:'https://web.stremio.com',name:'synthetic_identity',value:'B'});
      first.protocol.handle('https',()=>new Response('<!doctype html><title>Synthetic vendor surface</title><p>Synthetic fixture</p>',{headers:{'Content-Type':'text/html'}}));
    },{a,b});
    const opened=app.waitForEvent('window');await page.getByRole('button',{name:'Synthetic Local A',exact:true}).click();const vendor=await opened;
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);
    await vendor.close();
    await page.getByRole('button',{name:'Admin Settings',exact:true}).click();await page.getByLabel('Admin PIN',{exact:true}).fill('314159');await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.locator('.manage-row').filter({has:page.getByRole('heading',{name:'Synthetic Local A',exact:true})}).getByRole('button',{name:'Delete profile',exact:true}).click();
    await page.getByRole('button',{name:'Delete profile',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic Local A',exact:true})).toHaveCount(0);
    const cookies=await app.evaluate(async({session},{a,b})=>({a:await session.fromPartition(`persist:household-${a.id}`).cookies.get({url:'https://web.stremio.com'}),b:await session.fromPartition(`persist:household-${b.id}`).cookies.get({url:'https://web.stremio.com'})}),{a,b});
    expect(cookies.a).toEqual([]);expect(cookies.b[0].value).toBe('B');
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:500});}
});
