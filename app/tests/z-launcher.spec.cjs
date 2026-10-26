const {test,expect}=require('@playwright/test');
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('optional backend connection remains available behind local administrator unlock',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dxbi-household-app-'));
  const app=await electron.launch({args:[path.resolve(__dirname,'../dist/main.js'),'--no-stremio-server'],env:{...process.env,DXBI_HOUSEHOLD_DATA:dir}});
  try{
    const page=await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Welcome home.'})).toBeVisible();
    await page.getByLabel('Create admin PIN (6–12 digits)').fill('314159');await page.getByLabel('Confirm admin PIN').fill('314159');
    await page.getByRole('button',{name:'Set Up This Device'}).click();
    await page.getByLabel('Viewer name').fill('Synthetic viewer');await page.getByRole('button',{name:'Create Profile',exact:true}).click();
    await page.getByRole('button',{name:'Admin Settings',exact:true}).click();
    await page.getByRole('button',{name:'Optional Household server'}).click();
    await expect(page.getByRole('heading',{name:'Your household, connected.'})).toBeVisible();
    await page.getByLabel('Household server address').fill('http://127.0.0.1:8876');
    await page.getByRole('button',{name:'Connect',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Welcome to your household'})).toBeVisible();
    const prefs=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    expect(prefs.nodeIntegration).toBe(false);expect(prefs.contextIsolation).toBe(true);expect(prefs.sandbox).toBe(true);
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:500});}
});
