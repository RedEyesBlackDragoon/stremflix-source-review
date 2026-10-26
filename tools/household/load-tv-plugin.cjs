// Apply a source revision to the debug WebView for a hardware regression check.
// Does not read cookies, account tokens, addon URLs or profile storage.
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {chromium}=require('../../app/node_modules/playwright');
(async()=>{
 const source=process.argv.includes('--baseline')
  ?execFileSync('git',['show','HEAD:dxbi.plugin.js'],{encoding:'utf8',maxBuffer:16*1024*1024})
  :fs.readFileSync('dxbi.plugin.js','utf8');
 const browser=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('https://web.stremio.com/'));
  const keepRoute=process.argv.includes('--keep-route');
  await page.evaluate(({source,keepRoute})=>{
   const old=document.getElementById('dxbi.plugin.js');
   const wrapper=old.textContent,start=wrapper.indexOf('/**'),end=wrapper.lastIndexOf('} catch (err)');
   if(start<0||end<start)throw Error('Unexpected plugin wrapper');
   const script=document.createElement('script');script.id=old.id;
   script.textContent=wrapper.slice(0,start)+source+'\n'+wrapper.slice(end);
   old.remove();document.body.append(script);if(!keepRoute)location.hash='#/';
  },{source,keepRoute});
  if(!keepRoute)await page.waitForFunction(()=>[...document.querySelectorAll('a[title="See All"]')].some(n=>n.checkVisibility()));
  await page.waitForTimeout(700);
  console.log(process.argv.includes('--baseline')?'Baseline plugin loaded':'Patched plugin loaded');
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
