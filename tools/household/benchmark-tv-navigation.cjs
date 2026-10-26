const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../app/node_modules/playwright');

function setupFixture() {
      localStorage.setItem('dxbi.settings', JSON.stringify({ billboard: false, builtInTheme: false, previews: false, ratings: false, newEpisodes: false, uiSounds: false, splash: false, reviews: false, airing: false }));
      sessionStorage.setItem('dxbi.splash', '1');
      document.head.insertAdjacentHTML('beforeend', `<style>body{margin:0;background:#111;color:white}#app{height:720px;overflow:auto}.board-content-fixture{padding:20px}.meta-row-container{height:180px;position:relative}.meta-items-container{display:flex;overflow:auto;gap:10px}.meta-item-container{flex:0 0 130px;height:140px}.meta-item-link{display:block;width:130px;height:140px;background:#333}.meta-item-link:focus{outline:3px solid white}.dx-arrow,.dx-row-pages{display:none}</style>`);
      window.makeCard = (r, c) => {const n=document.createElement('div');n.className='meta-item-container';n.innerHTML=`<a class="meta-item-link" href="#/detail/movie/fixture-${r}-${c}" tabindex="0"><div class="poster-container"></div><span class="title-label">Fixture ${r}-${c}</span></a>`;return n};
      const app=document.createElement('div');app.id='app';const board=document.createElement('div');board.className='board-content-fixture';app.append(board);document.body.append(app);
      for(let r=0;r<40;r++){const row=document.createElement('div');row.className='meta-row-container';const track=document.createElement('div');track.className='meta-items-container';for(let c=0;c<20;c++)track.append(window.makeCard(r,c));row.append(track);board.append(row)}
      location.hash='#/';
      const visibility=Element.prototype.checkVisibility;
      const rect=Element.prototype.getBoundingClientRect;
      window.work={visibility:0,rect:0};
      Element.prototype.checkVisibility=function(...args){window.work.visibility++;return visibility.apply(this,args)};
      Element.prototype.getBoundingClientRect=function(...args){window.work.rect++;return rect.apply(this,args)};
}

async function runNavigationSample() {
      const tracks=[...document.querySelectorAll('.meta-items-container')];
      tracks[0].querySelector('a').focus({preventScroll:true});
      const samples=[];
      for(let n=0;n<30;n++){
        // An unrelated catalog receives another poster while the viewer browses.
        tracks[39].append(window.makeCard(39,20+n));
        await new Promise(resolve=>queueMicrotask(resolve));
        work.visibility=0;work.rect=0;
        const start=performance.now();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:n%2?'ArrowUp':'ArrowDown',bubbles:true,cancelable:true}));
        const elapsed=performance.now()-start;
        const row=tracks.findIndex(t=>t.contains(document.activeElement));
        if(row!==(n%2?0:1))throw Error('Unexpected focus row '+row);
        samples.push({ms:elapsed,...work});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
      const cards=document.querySelectorAll('.meta-item-container').length;
      const press=async(key,expected)=>{
        await new Promise(resolve=>queueMicrotask(resolve));
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
        if(document.activeElement!==expected)throw Error('Focus did not follow catalog changes');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      };
      const originalLast=tracks[0].lastElementChild.querySelector('a');
      const added=window.makeCard(0,20);tracks[0].append(added);
      originalLast.focus({preventScroll:true});
      await press('ArrowRight',added.querySelector('a'));
      const preceding=tracks[0].children[18].querySelector('a');
      tracks[0].children[19].remove();
      await press('ArrowLeft',preceding);
      // An entire row arriving between existing rows must change vertical navigation.
      const row=document.createElement('div');row.className='meta-row-container';
      const track=document.createElement('div');track.className='meta-items-container';
      track.append(window.makeCard(99,0));row.append(track);tracks[0].parentElement.after(row);
      tracks[0].firstElementChild.querySelector('a').focus({preventScroll:true});
      await press('ArrowDown',track.querySelector('a'));
      tracks[0].firstElementChild.querySelector('a').focus({preventScroll:true});row.remove();
      await press('ArrowDown',tracks[1].firstElementChild.querySelector('a'));
      return {samples,acceptedMoves:samples.length,failures:0,cards,catalogChangeChecks:4};
}

// Controlled catalog-arrival workload. No account, media, or external network access.
async function measure(browser, source) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, userAgent: 'Chrome/155 dxbi-tv/1' });
  try {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><head><title>Fixture</title></head><body></body></html>' }));
    await page.goto('https://fixture.invalid/');
    await page.evaluate(setupFixture);
    await page.addScriptTag({content: source});
    await page.waitForTimeout(300);
    const result = await page.evaluate(runNavigationSample);
    assert.equal(result.acceptedMoves,30); assert.equal(result.cards,830);
    return result;
  } finally { await page.close(); }
}
async function main() {
  if (process.argv[2] === '--prepare-android') {
    assert(process.argv[3], 'Supply the baseline plugin path');
    const out=path.resolve(__dirname,'../../tv/build/generated/navigationBenchmark');
    fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'navigation-fixture.html'),fixtureHtml());
    fs.copyFileSync(path.resolve(process.argv[3]),path.join(out,'baseline.plugin.js'));
    console.log('Prepared isolated Android benchmark assets');
    return;
  }
  const baseline = process.argv[2];
  assert(baseline, 'Usage: node tools/household/benchmark-tv-navigation.cjs <baseline-plugin> [candidate-plugin]');
  const candidate = process.argv[3];
  const browser=await chromium.launch({headless:true});
  try {
    for(let run=0;run<5;run++)for(const [variant,file] of [['baseline',baseline],...(candidate?[['candidate',candidate]]:[])]){
      const result=await measure(browser,fs.readFileSync(path.resolve(file),'utf8'));
      const sorted=result.samples.map(s=>s.ms).sort((a,b)=>a-b);
      console.log(JSON.stringify({variant,run,acceptedMoves:result.acceptedMoves,failures:result.failures,cards:result.cards,medianHandlerMs:sorted[15],maxVisibilityChecks:Math.max(...result.samples.map(s=>s.visibility)),meanVisibilityChecks:result.samples.reduce((sum,s)=>sum+s.visibility,0)/30}));
    }
  } finally {await browser.close()}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
function fixtureHtml() {
  return '<!doctype html><html><head><title>Navigation benchmark</title></head><body><script>('
    + setupFixture.toString() + ')();</script><script src="https://fixture.invalid/plugin.js"></script><script>window.runNavigationSample='
    + runNavigationSample.toString() + ';window.fixtureReady=true;</script></body></html>';
}
module.exports={measure,fixtureHtml};
