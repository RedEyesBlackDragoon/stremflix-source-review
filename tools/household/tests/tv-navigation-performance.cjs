const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('../../../app/node_modules/playwright');
const {measure}=require('../benchmark-tv-navigation.cjs');
test('late catalog posters preserve correct remote focus without rescanning the full catalog',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const result=await measure(browser,fs.readFileSync(path.resolve('dxbi.plugin.js'),'utf8'));
  assert.equal(result.failures,0);
  assert.equal(result.acceptedMoves,30);
  const warm=result.samples.slice(1);
  assert(Math.max(...warm.map(s=>s.visibility))<150,'A poster arriving in one row must not require checking visibility of all 800 posters on the next arrow press');
 }finally{await browser.close()}
});

test('TV grid focus follows visual sorting, resized columns and hidden posters',async()=>{
 const {fixtureHtml}=require('../benchmark-tv-navigation.cjs');
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:720},userAgent:'Chrome/155 dxbi-tv/1'});
 try{
  const plugin=fs.readFileSync(path.resolve('dxbi.plugin.js'),'utf8');
  await page.route('**/*',route=>route.fulfill({contentType:route.request().url().endsWith('/plugin.js')?'application/javascript':'text/html',body:route.request().url().endsWith('/plugin.js')?plugin:fixtureHtml()}));
  await page.goto('https://fixture.invalid/');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.waitForTimeout(300);
  await page.evaluate(async()=>{
   document.querySelector('.board-content-fixture').style.display='none';
   const root=document.createElement('div');root.className='discover-content-fixture';
   const track=document.createElement('div');track.className='meta-items-container';track.style.cssText='flex-wrap:wrap;width:560px;overflow:visible';
   for(let i=0;i<16;i++){const card=makeCard(98,i);card.style.order=String(15-i);track.append(card)}
   root.append(track);document.querySelector('#app').append(root);location.hash='#/discover/movie/fixture';
   const press=async expected=>{
    track.children[15].querySelector('a').focus({preventScroll:true});
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    if(document.activeElement!==track.children[expected].querySelector('a'))throw Error('Visual grid position was not preserved');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   };
   await new Promise(resolve=>setTimeout(resolve,100));
   await press(11);
   track.style.width='420px';window.dispatchEvent(new Event('resize'));
   await press(12);
   track.children[12].style.display='none';window.dispatchEvent(new Event('resize'));
   await press(11);
   document.head.insertAdjacentHTML('beforeend','<style>.dx-watched-hide [data-dx-watched]{display:none}</style>');
   track.children[12].style.display='';window.dispatchEvent(new Event('resize'));
   await press(12);
   const watched=document.createElement('span');watched.className='watched-icon-layer';track.children[12].append(watched);
   window.__dxbi.settings.watchedTitles='hide';window.__dxbi.sync();
   await press(11);
   watched.remove();window.__dxbi.sync();
   await press(12);
  });
 }finally{await browser.close()}
});
