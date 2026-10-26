const assert=require('node:assert/strict');
const {chromium}=require('../../app/node_modules/playwright');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.TV_CDP||'http://127.0.0.1:9224');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('https://web.stremio.com/'));
  await page.evaluate(()=>{location.hash='#/'});
  await page.waitForFunction(()=>[...document.querySelectorAll('[class*="meta-row-container"]')].filter(n=>n.checkVisibility()&&n.querySelector('[class*="meta-item-container"]')).length>=5);
  const start=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('[class*="meta-row-container"]')].filter(n=>n.checkVisibility()&&n.querySelector('[class*="meta-item-container"]'));
   const index=Math.min(5,rows.length-1),row=rows[index];
   row.scrollIntoView({block:'center',behavior:'instant'});
   row.querySelector('[class*="meta-item-container"] a[href]').focus({preventScroll:true});
   return index;
  });
  const cdp=await page.context().newCDPSession(page),positions=[];
  try{
   for(let repeat=0;repeat<start;repeat++){
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,autoRepeat:repeat>0});
    await page.waitForTimeout(80);
    positions.push(await page.evaluate(()=>{
     const rows=[...document.querySelectorAll('[class*="meta-row-container"]')].filter(n=>n.checkVisibility()&&n.querySelector('[class*="meta-item-container"]'));
     return rows.indexOf(document.activeElement.closest('[class*="meta-row-container"]'));
    }));
   }
  }finally{await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38})}
  console.log(JSON.stringify({start,upRepeatPositions:positions}));
  assert.deepEqual(positions,Array.from({length:start},(_,i)=>start-i-1),'Held Up must move one catalog row on every repeat, without stopping on row headers');
  console.log('PASS: held Up reaches the first row without a focus trap');
 }finally{await browser.close()}
})().catch(error=>{console.error(error.message.replace(/https[^\s]+/g,'<redacted-url>'));process.exitCode=1});
