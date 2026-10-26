const {chromium}=require('../../app/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
(async()=>{
 const root=path.resolve('shared/local');
 const server=http.createServer(async(req,res)=>{const name=req.url.slice(1);if(!['index.html','local.js','style.css'].includes(name)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',{'index.html':'text/html','local.js':'text/javascript','style.css':'text/css'}[name]);res.end(await fs.readFile(path.join(root,name)))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  for(const count of [0,2,6]){
   const page=await browser.newPage({viewport:{width:1280,height:720}});
   await page.addInitScript(count=>{
    const colors=['plum','blue','teal','coral','gold','plum'];
    const names=['Viewer One','Viewer Two','Alex','Jordan','Taylor','Sam'];
    const state={configured:true,managementUnlocked:true,platform:'android-tv',profiles:names.slice(0,count).map((name,i)=>({name,id:String(i),avatar:colors[i],linked:true}))};
    window.__pickerCalls=[];
    window.LocalHousehold={call:async(method,value)=>{window.__pickerCalls.push(method);if(method==='state')return state;if(method==='open')return true;throw Error('Unexpected fixture mutation: '+method)}};
   },count);
   await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
   await page.waitForSelector('body[data-page="picker"]');
   assert.equal(await page.locator('.profile').count(),count||1);
   assert(await page.evaluate(()=>document.activeElement.matches('.profile')),'Picker must start on an actionable profile');
   if(count===2){
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Viewer Two');
    await page.keyboard.press('ArrowDown');assert(await page.locator(':focus').evaluate(n=>n.classList.contains('picker-manage')));
    await page.keyboard.press('ArrowUp');assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Viewer Two');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await page.locator('body').getAttribute('data-page'),'settings');
    await page.keyboard.press('Escape');assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Viewer Two');
    await page.keyboard.press('Enter');await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.__pickerCalls.filter(x=>x==='open').length),1,'Repeated OK must not open multiple sessions');
   }
   const clipped=await page.locator('.profile,.picker-manage').evaluateAll(ns=>ns.some(n=>{const r=n.getBoundingClientRect();return r.left<8||r.right>innerWidth-8||r.top<8||r.bottom>innerHeight-8}));
   assert(!clipped,'Profile controls must fit in the viewport');
   await page.screenshot({path:`artifacts/household-tv-local/picker-${count}-profiles.png`});
   console.log(`PASS: ${count} profiles; initial focus, layout${count===2?', remote round trip, management, and single account launch':''}`);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e.message);process.exitCode=1});
