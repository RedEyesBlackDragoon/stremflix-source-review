const assert=require('node:assert/strict');
const {chromium}=require('../../app/node_modules/playwright');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://web.stremio.com/'))[Number(process.env.TV_PAGE_INDEX||0)];
  assert(page,'Open a viewer in the TV app');
  await page.waitForFunction(()=>[...document.querySelectorAll('[class*="library-content"] [class*="meta-item-container"]')].filter(n=>n.checkVisibility()).length>=20);
  const setup=await page.evaluate(()=>{
   const root=[...document.querySelectorAll('[class*="library-content"]')].find(n=>n.checkVisibility());
   const cards=[...root.querySelectorAll('[class*="meta-item-container"]')].filter(n=>n.checkVisibility());
   const sorted=cards.map(n=>({n,r:n.getBoundingClientRect()})).sort((a,b)=>Math.abs(a.r.top-b.r.top)>5?a.r.top-b.r.top:a.r.left-b.r.left);
   const firstTop=sorted[0].r.top,columns=sorted.filter(v=>Math.abs(v.r.top-firstTop)<5).length;
   const start=Math.min(columns*3+1,sorted.length-1);
   window.__tvLibraryCards=sorted.map(v=>v.n);
   window.__tvLibraryKeys=[];
   if(!window.__tvLibraryListener){window.__tvLibraryListener=e=>window.__tvLibraryKeys.push(e.key);window.addEventListener('keydown',window.__tvLibraryListener,true)}
   const target=sorted[start].n;target.scrollIntoView({block:'center',behavior:'instant'});
   target.querySelector('a[href]').focus({preventScroll:true});
   return {columns,start,count:cards.length};
  });
  const cdp=await page.context().newCDPSession(page),positions=[];
  try{
   for(let repeat=0;repeat<3;repeat++){
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,autoRepeat:false});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
    await page.waitForTimeout(80);
    positions.push(await page.evaluate(()=>window.__tvLibraryCards.indexOf(document.activeElement.closest('[class*="meta-item-container"]'))));
   }
  }finally{await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38})}
  const diagnostics=await page.evaluate(()=>({keys:window.__tvLibraryKeys,orderStable:window.__tvLibraryCards.every((card,i,all)=>i===0 || (Number(getComputedStyle(all[i-1]).order)||0)<=(Number(getComputedStyle(card).order)||0))}));
  console.log(JSON.stringify({...setup,visualPositions:positions,...diagnostics}));
  assert.deepEqual(positions,Array.from({length:3},(_,i)=>setup.start-(i+1)*setup.columns),'Library Up must follow visual rows and stay out of filters');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,autoRepeat:true});
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[class*="meta-item-container"]')),true,'Held Up must stop in the first grid row');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[class*="selectable-inputs-container"], .dxl-tools')),true,'Fresh Up at the top deliberately enters filters');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[class*="meta-item-container"]')),true,'Down from filters returns to the grid');
  const returnedColumn=await page.evaluate(()=>{
   const track=document.activeElement.closest('[class*="meta-items-container"]');
   const cards=[...track.children].filter(n=>n.matches('[class*="meta-item-container"]')&&n.checkVisibility()).sort((a,b)=>(Number(getComputedStyle(a).order)||0)-(Number(getComputedStyle(b).order)||0));
   return cards.indexOf(document.activeElement.closest('[class*="meta-item-container"]'));
  });
  assert.equal(returnedColumn,setup.start%setup.columns,'Returning from filters must preserve the grid column');
  await page.waitForTimeout(150);
  const burst=await page.evaluate(()=>{
   const track=document.activeElement.closest('[class*="meta-items-container"]');
   const cards=[...track.children].filter(n=>n.matches('[class*="meta-item-container"]')&&n.checkVisibility()).sort((a,b)=>(Number(getComputedStyle(a).order)||0)-(Number(getComputedStyle(b).order)||0));
   const start=cards.indexOf(document.activeElement.closest('[class*="meta-item-container"]'));
   window.__tvBurstCards=cards;
   for(let i=0;i<50;i++)document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',repeat:true,bubbles:true,cancelable:true}));
   return {start,end:cards.indexOf(document.activeElement.closest('[class*="meta-item-container"]'))};
  });
  await page.waitForTimeout(400);
  const settled=await page.evaluate(()=>window.__tvBurstCards.indexOf(document.activeElement.closest('[class*="meta-item-container"]')));
  assert.equal(burst.end-burst.start,setup.columns,'A same-frame burst must advance only one visible row');
  assert.equal(settled,burst.end,'Excess repeats must not replay after rendering catches up');
  console.log(JSON.stringify({filterRoundTrip:true,burstRepeatCount:50,acceptedRowMoves:1,noDelayedCatchUp:true}));
  console.log('PASS: Library navigation follows displayed sort order');
 }finally{
  for(const page of browser.contexts().flatMap(c=>c.pages()))if(page.url().startsWith('https://web.stremio.com/'))await page.evaluate(()=>{
   if(window.__tvLibraryListener)window.removeEventListener('keydown',window.__tvLibraryListener,true);
   for(const key of ['__tvLibraryListener','__tvLibraryKeys','__tvLibraryCards','__tvBurstCards'])delete window[key];
  }).catch(()=>{});
  await browser.close();
 }
})().catch(error=>{console.error(error.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
