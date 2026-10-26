const assert=require('node:assert/strict');
const {chromium}=require('../../app/node_modules/playwright');
const {execFileSync}=require('node:child_process');
(async()=>{
 const b=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  const p=b.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://web.stremio.com/'))[Number(process.env.TV_PAGE_INDEX||0)];
  await p.evaluate(()=>location.hash='#/library');
  await p.waitForFunction(()=>[...document.querySelectorAll('a[class*="nav-tab-button"].selected')].some(n=>n.title==='Library'&&n.checkVisibility()));
  await p.waitForTimeout(500);
  await p.evaluate(()=>{const n=[...document.querySelectorAll('a[class*="nav-tab-button"]')].find(n=>n.title==='Library'&&n.checkVisibility());n.tabIndex=0;n.focus({preventScroll:true})});
  for(const [code,title] of [[21,'Discover'],[21,'Board'],[22,'Discover']]){
   execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','input','keyevent',String(code)]);
   const state=await p.evaluate(()=>{const n=document.activeElement,s=getComputedStyle(n),label=n.querySelector('[class*="label"]');return{focus:n.title,selected:[...document.querySelectorAll('a[class*="nav-tab-button"].selected')].filter(n=>n.checkVisibility()).map(n=>n.title),outline:s.outlineStyle,background:s.backgroundColor,labelColor:label&&getComputedStyle(label).color,labelOpacity:label&&getComputedStyle(label).opacity}});
   assert.equal(state.focus,title);assert.deepEqual(state.selected,['Library']);
   assert.equal(state.outline,'none');assert.equal(state.background,'rgba(0, 0, 0, 0)');
   assert.equal(state.labelColor,'rgb(255, 255, 255)');assert.equal(state.labelOpacity,'1');
   console.log(JSON.stringify(state));
  }
  console.log('PASS: Home/Discover focus is white without a rectangle; active Library selection stays separate');
 }finally{await b.close()}
})().catch(e=>{console.error(e.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
