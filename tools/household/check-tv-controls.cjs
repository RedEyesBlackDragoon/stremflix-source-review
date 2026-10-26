const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('../../app/node_modules/playwright');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://web.stremio.com/'))[Number(process.env.TV_PAGE_INDEX||0)];
  page.setDefaultTimeout(15000);
  await page.waitForFunction(()=>[...document.querySelectorAll('[class*="library-content"] [class*="selectable-inputs-container"]')].some(n=>n.checkVisibility()));
  const vertical=await page.evaluate(()=>{const links=[...document.querySelectorAll('a[class*="nav-tab-button"]')].filter(n=>n.checkVisibility());const a=links[0].getBoundingClientRect(),b=links[1].getBoundingClientRect();return Math.abs(b.top-a.top)>Math.abs(b.left-a.left)});
  await page.evaluate(()=>{
   const all=[...document.querySelectorAll('[class*="library-content"] [class*="selectable-inputs-container"] [tabindex]')].find(n=>n.checkVisibility());
   all.focus({preventScroll:true});
  });
  await page.evaluate(()=>{window.__tvControlKeys=[];window.__tvControlKeyListener=e=>window.__tvControlKeys.push(e.key);window.addEventListener('keydown',window.__tvControlKeyListener,true)});
  const press=async key=>{await page.evaluate(()=>{window.__tvControlKeys=[]});execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','input','keyevent',String({ArrowUp:19,ArrowDown:20,ArrowLeft:21,ArrowRight:22,Enter:23}[key])]);await page.waitForTimeout(60);const received=await page.evaluate(()=>window.__tvControlKeys);assert.deepEqual(received,[key],'Unexpected concurrent remote input')};
  const focus=()=>page.evaluate(()=>{const n=document.activeElement;return n.tagName==='SELECT'?'Genre':n.title||n.textContent.trim()});
  const expectFocus=async(label,message)=>assert.equal((await focus()).toLowerCase(),label.toLowerCase(),message);
  await press('ArrowRight');
  await expectFocus('Last Watched','Right from All must reach native sort controls');
  console.log('PASS: All to Last Watched');
  for(const label of ['A-Z','Z-A','Most Watched','Watched','Not Watched']){
   await press('ArrowRight');await expectFocus(label);
  }
  for(let i=0;i<6;i++)await press('ArrowLeft');
  await expectFocus('All');
  await press('ArrowDown');await expectFocus('Newest','Down must reach the second filter row before the grid');
  for(const label of ['Oldest','Top rated','Genre']){await press('ArrowRight');await expectFocus(label)}
  await press('ArrowLeft');await expectFocus('Top rated','Genre control must not trap directional focus');
  console.log('PASS: both filter rows and Genre exit');
  await page.evaluate(()=>{[...document.querySelectorAll('[class*="library-content"] [class*="selectable-inputs-container"] [tabindex]')].find(n=>n.checkVisibility()).focus()});
  await press('ArrowUp');await expectFocus('Library','Up must reach the visible navigation link');
  await press(vertical?'ArrowUp':'ArrowLeft');await expectFocus('Discover');
  await press(vertical?'ArrowUp':'ArrowLeft');await expectFocus('Board');
  await press(vertical?'ArrowDown':'ArrowRight');await expectFocus('Discover');
  await press(vertical?'ArrowDown':'ArrowRight');await expectFocus('Library');
  await press(vertical?'ArrowRight':'ArrowDown');await expectFocus('All','Navigation leaves the header for filter controls');
  console.log('PASS: filter-to-sidebar round trip and Home/Discover/Library traversal');
  if(process.argv.includes('--activate-nav')){
   const originalHash=await page.evaluate(()=>location.hash);
   for(const title of ['Board','Discover','Library']){
    await page.waitForTimeout(500);
    await page.waitForFunction(title=>[...document.querySelectorAll('a[class*="nav-tab-button"]')].some(n=>n.title===title&&n.checkVisibility()),title);
    await page.evaluate(title=>{const n=[...document.querySelectorAll('a[class*="nav-tab-button"]')].find(n=>n.title===title&&n.checkVisibility());n.tabIndex=0;n.focus({preventScroll:true})},title);
    await press('Enter');
    await page.waitForFunction(title=>(title==='Board'?/^#\/?$/.test(location.hash):location.hash.startsWith('#/'+title.toLowerCase()))&&[...document.querySelectorAll('a[class*="nav-tab-button"].selected')].some(n=>n.title===title&&n.checkVisibility()),title);
    console.log('PASS: OK opens '+title);
   }
   await page.evaluate(hash=>{location.hash=hash},originalHash);
   console.log('PASS: native remote OK activates Home/Board, Discover and Library');
  }
  console.log('PASS: all native sorts, extra sorts, Genre, Home/Board, Discover and Library are reachable without changing preferences');
 }finally{for(const page of browser.contexts().flatMap(c=>c.pages()))if(page.url().startsWith('https://web.stremio.com/'))await page.evaluate(()=>{if(window.__tvControlKeyListener)window.removeEventListener('keydown',window.__tvControlKeyListener,true);delete window.__tvControlKeyListener;delete window.__tvControlKeys}).catch(()=>{});await browser.close()}
})().catch(e=>{console.error(e.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
