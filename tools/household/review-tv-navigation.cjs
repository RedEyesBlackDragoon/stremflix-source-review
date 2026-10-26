// Navigation probes only. Requires the already-open Viewer Two viewer; no playback,
// account changes or persistent catalog mutations. Outputs no media identifiers.
const {chromium}=require('../../app/node_modules/playwright');
const {execFileSync}=require('node:child_process');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 const results={};let page;
 const press=async code=>{execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','input','keyevent',String(code)]);await page.waitForTimeout(150)};
 try{
  const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://web.stremio.com/'));
  const index=Number(process.env.TV_PAGE_INDEX);
  if(!Number.isInteger(index)||!pages[index])throw Error('Set TV_PAGE_INDEX to the verified Viewer Two target');
  page=pages[index];page.setDefaultTimeout(15000);
  await page.waitForFunction(()=>[...document.querySelectorAll('[class*="library-content"] [class*="meta-item-container"]')].filter(n=>n.checkVisibility()).length>=20);
  await page.evaluate(()=>{
   const root=[...document.querySelectorAll('[class*="library-content"]')].find(n=>n.checkVisibility());
   const track=root.querySelector('[class*="meta-items-container"]');
   window.__navAudit={hash:location.hash,focus:document.activeElement,track,top:track.scrollTop,left:track.scrollLeft};
  });
  results.navLayout=await page.evaluate(()=>{
   const links=[...document.querySelectorAll('a[class*="nav-tab-button"]')].filter(n=>n.checkVisibility());
   const lib=links.find(n=>n.title==='Library'),discover=links.find(n=>n.title==='Discover');
   lib.tabIndex=0;lib.focus({preventScroll:true});
   const a=lib.getBoundingClientRect(),b=discover.getBoundingClientRect();
   return {deltaX:Math.round(a.x-b.x),deltaY:Math.round(a.y-b.y),classSaysVertical:!!lib.parentElement.closest('[class*="vertical-nav-bar"]')};
  });
  await press(22);
  results.rightFromLibrary=await page.evaluate(()=>({target:document.activeElement.title||document.activeElement.textContent.trim(),expected:'Calendar'}));
  results.partialRow=await page.evaluate(()=>{
   const t=window.__navAudit.track;
   const cards=[...t.children].filter(n=>n.matches('[class*="meta-item-container"]')&&n.checkVisibility()).sort((a,b)=>(Number(getComputedStyle(a).order)||0)-(Number(getComputedStyle(b).order)||0));
   const columns=cards.findIndex((n,i)=>i&&Math.abs(n.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)>5);
   const start=Math.floor(cards.length/columns)*columns-1;
   window.__navAudit.cards=cards;
   cards[start].querySelector('a[href]').focus({preventScroll:true});
   return {count:cards.length,columns,start,expected:cards.length-1};
  });
  await press(20);
  results.partialRow.actual=await page.evaluate(()=>window.__navAudit.cards.indexOf(document.activeElement.closest('[class*="meta-item-container"]')));
  await page.evaluate(()=>{const n=window.__navAudit.cards[25];n.scrollIntoView({block:'center',behavior:'instant'});n.querySelector('a[href]').focus({preventScroll:true});window.__navAudit.returnLink=document.activeElement.getAttribute('href');window.__navAudit.returnTop=window.__navAudit.track.scrollTop});
  await press(23);
  await page.waitForFunction(()=>location.hash.startsWith('#/detail/'));
  await page.waitForTimeout(700);
  results.detailsEntry=await page.evaluate(()=>({focusTag:document.activeElement.tagName,focusInsideDetails:!!document.activeElement.closest('[class*="metadetails"], [class*="meta-details"]')}));
  await press(4);
  await page.waitForFunction(()=>location.hash.startsWith('#/library'));
  await page.waitForTimeout(500);
  results.detailsBack=await page.evaluate(()=>({sameItem:document.activeElement.getAttribute('href')===window.__navAudit.returnLink,focusTag:document.activeElement.tagName,scrollDelta:Math.round(window.__navAudit.track.scrollTop-window.__navAudit.returnTop)}));
  await page.evaluate(()=>{
   const all=[...document.querySelectorAll('[class*="library-content"] [class*="selectable-inputs-container"] [tabindex]')].find(n=>n.checkVisibility());
   all.focus();window.__navAudit.opener=all;
   window.StremioEnhancedAPI.showAlert('info','Navigation review','Dismiss to test focus restoration',['OK']);
  });
  await page.waitForFunction(()=>!!document.querySelector('.dxtv-modal'));
  await press(23);
  results.dialogDismiss=await page.evaluate(()=>({closed:!document.querySelector('.dxtv-modal'),returnedToOpener:document.activeElement===window.__navAudit.opener,focusTag:document.activeElement.tagName}));
  await page.evaluate(()=>window.__navAudit.opener.focus());
  await press(23);
  results.typeMenuOpen=await page.evaluate(()=>({popupCount:[...document.querySelectorAll('[class*="menu-container"], [class*="dropdown"]')].filter(n=>n.checkVisibility()).length,focusTag:document.activeElement.tagName}));
  await press(20);
  results.typeMenuDown=await page.evaluate(()=>({focusInFilters:!!document.activeElement.closest('[class*="selectable-inputs-container"],.dxl-tools'),focusInGrid:!!document.activeElement.closest('[class*="meta-item-container"]'),focusText:document.activeElement.textContent.trim().slice(0,40)}));
  await press(4);
  results.typeMenuBack=await page.evaluate(()=>({stillLibrary:location.hash.startsWith('#/library'),focusTag:document.activeElement.tagName}));
  console.log(JSON.stringify(results,null,2));
  if(process.argv.includes('--assert')){
   const failures=[];
   if(results.rightFromLibrary.target!==results.rightFromLibrary.expected)failures.push('horizontal header Right');
   if(results.partialRow.actual!==results.partialRow.expected)failures.push('partial last-row Down');
   if(!results.detailsBack.sameItem)failures.push('details Back focus restoration');
   if(!results.dialogDismiss.returnedToOpener)failures.push('dialog opener restoration');
   if(failures.length)throw Error('Navigation regressions: '+failures.join(', '));
  }
 }finally{
  if(page)await page.evaluate(()=>{const a=window.__navAudit;if(!a)return;document.querySelector('.dxtv-modal')?.remove();if(location.hash!==a.hash)location.hash=a.hash;if(a.track?.isConnected){a.track.scrollTop=a.top;a.track.scrollLeft=a.left}if(a.focus?.isConnected)a.focus.focus({preventScroll:true});delete window.__navAudit}).catch(()=>{});
  await browser.close();
 }
})().catch(e=>{console.error(e.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
