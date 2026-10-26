const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('../../app/node_modules/playwright');
const adb=process.env.ADB_PATH||'adb';
const serial=process.env.TV_SERIAL||'YOUR_TV_SERIAL';
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('https://web.stremio.com/'));
  assert(page,'Open a viewer in the Android TV app first');
  await page.evaluate(()=>{location.hash='#/'});
  await page.waitForFunction(()=>[...document.querySelectorAll('a[title="See All"]')].some(n=>n.checkVisibility()));
  const walk=process.argv.includes('--walk-row');
  const prepared=await page.evaluate(walk=>{
   if([...document.querySelectorAll('[class*="modal-container"]')].some(n=>n.checkVisibility()))throw Error('Close the Stremio promotion/dialog before checking catalog navigation');
   const more=[...document.querySelectorAll('a[title="See All"]')].find(n=>n.checkVisibility());
   if(!more)return {prepared:false};
   const row=more.closest('[class*="meta-row-container"]');
   const cards=row?.querySelectorAll('[class*="meta-item-container"]');
   if(!cards?.length)return {prepared:false};
   const last=walk?cards[0]:cards[cards.length-1];
   window.__tvExpectedCatalog=more.getAttribute('href');
   row.scrollIntoView({block:'center',behavior:'instant'});
   const link=last.querySelector('a[href], [tabindex]');
   link.focus({preventScroll:true});
   if(document.activeElement!==link)throw Error('Poster did not receive focus');
   return {prepared:true,posterCount:cards.length};
  },walk);
  assert(prepared.prepared,'A catalog row with posters is required');
  for(let index=0;index<(walk?prepared.posterCount:1);index++){
   execFileSync(adb,['-s',serial,'shell','input','keyevent','22']);
   await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
  const result=await page.evaluate(()=>({seeAllFocused:document.activeElement?.matches('a[title="See All"]')||false}));
  console.log(JSON.stringify({...prepared,...result}));
  assert(result.seeAllFocused,'Remote navigation from the catalog poster must reach See All');
  execFileSync(adb,['-s',serial,'shell','input','keyevent','23']);
  await page.waitForFunction(()=>location.hash===window.__tvExpectedCatalog,null,{timeout:10000});
  await page.waitForFunction(()=>[...document.querySelectorAll('[class*="discover-content"] [class*="meta-item-container"]')].some(n=>n.checkVisibility()),null,{timeout:20000});
  const grid=await page.evaluate(()=>({posterCount:[...document.querySelectorAll('[class*="discover-content"] [class*="meta-item-container"]')].filter(n=>n.checkVisibility()).length}));
  console.log(JSON.stringify({fullCatalogOpened:true,...grid}));
  console.log('PASS: remote Right reaches See All and OK opens the complete catalog');
 }finally{await browser.close()}
})().catch(error=>{console.error(error.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
