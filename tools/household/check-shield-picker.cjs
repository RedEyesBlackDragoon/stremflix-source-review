const {chromium}=require('../../app/node_modules/playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 let b=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  let p=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('appassets.androidplatform'));
  await p.waitForSelector('body[data-page="picker"] .profile');
  const press=async code=>{execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','input','keyevent',String(code)]);await p.waitForTimeout(120)};
  await p.getByRole('button',{name:'Viewer Two',exact:true}).focus();
  await press(21);assert.notEqual(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  await press(22);assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  const selected=await p.locator(':focus .avatar').evaluate(n=>({width:n.getBoundingClientRect().width,outline:getComputedStyle(n).outlineColor}));
  assert.equal(selected.outline,'rgb(255, 255, 255)');
  await press(20);assert(await p.locator(':focus').evaluate(n=>n.classList.contains('picker-manage')));
  await press(19);assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  await press(20);await press(23);await p.waitForSelector('body[data-page="settings"]');
  await press(4);await p.waitForSelector('body[data-page="picker"]');
  assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  console.log('PASS: native Left/Right, white avatar focus, Down/Up to management, OK and Back restore Viewer Two');
  await press(23);
  // Android creates another WebView target; reconnect to enumerate that target.
  await b.close();
  b=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
  p=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('appassets.androidplatform'));
  let vendor;
  for(let i=0;i<80;i++){vendor=b.contexts().flatMap(c=>c.pages()).find(q=>q.url().startsWith('https://web.stremio.com/'));if(vendor)break;await p.waitForTimeout(250)}
  assert(vendor,'Viewer Two viewer must open');
  await vendor.evaluate(()=>location.hash='#/library');
  await vendor.waitForFunction(()=>[...document.querySelectorAll('[class*="library-content"] [class*="meta-item-container"]')].filter(n=>n.checkVisibility()).length>=20,null,{timeout:30000});
  console.log('PASS: native OK opens Viewer Two with a populated Library');
  // WebView readiness can precede the Android activity/window handoff.
  let stableMain=0;
  for(let i=0;i<24&&stableMain<3;i++){
   const windows=execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','dumpsys','window'],{encoding:'utf8'});
   stableMain=windows.split('\n').some(line=>line.includes('mCurrentFocus=')&&line.includes('MainActivity'))?stableMain+1:0;
   await p.waitForTimeout(500);
  }
  assert.equal(stableMain,3,'Browse must be the foreground native window before testing Back');
  await vendor.evaluate(()=>location.hash='#/');
  await vendor.waitForTimeout(700);
  // Keep the two presses inside the app's 2.5-second exit confirmation window.
  execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','input','keyevent','4','4']);
  await p.waitForSelector('body[data-page="picker"]');await p.waitForTimeout(500);
  let foreground=false;
  for(let i=0;i<24;i++){
   const windows=execFileSync(process.env.ADB_PATH||'adb',['-s',process.env.TV_SERIAL||'YOUR_TV_SERIAL','shell','dumpsys','window'],{encoding:'utf8'});
   foreground=windows.split('\n').some(line=>line.includes('mCurrentFocus=')&&line.includes('HouseholdActivity'));
   if(foreground)break;
   await p.waitForTimeout(500);
  }
  assert(foreground,'The picker must be the foreground native window');
  assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  await press(21);assert.notEqual(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  await press(22);assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Viewer Two');
  console.log('PASS: Back from Home returns to the foreground picker with working D-pad and Viewer Two focus');
 }finally{await b.close()}
})().catch(e=>{console.error(e.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
