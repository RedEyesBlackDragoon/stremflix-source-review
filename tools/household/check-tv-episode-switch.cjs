const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('../../app/node_modules/playwright');

(async () => {
  const [series, first, target] = process.argv.slice(2);
  assert(series && first && target, 'Usage: node check-tv-episode-switch.cjs ttSERIES season:episode season:episode');
  const adb = (...args) => execFileSync(process.env.ADB_PATH || 'adb',
    ['-s', process.env.TV_SERIAL || 'YOUR_TV_SERIAL', ...args], { encoding: 'utf8' });
  const browser = await chromium.connectOverCDP(process.env.TV_CDP || 'http://127.0.0.1:9224');
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://web.stremio.com/'));
    assert(page, 'Open a Stremio profile on the TV first');
    page.setDefaultTimeout(20000);
    if (/mResumedActivity:.*PlayerActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities'))) {
      adb('shell', 'input', 'keyevent', '4');
      await page.waitForTimeout(1500);
    }
    page.on('console', message => {
      if (message.text().startsWith('[episode-check]')) console.log(message.text());
    });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) console.log('Navigation:', new URL(frame.url()).hash.split('/')[1] || 'home');
    });
    await page.evaluate(({ series, first }) => {
      location.hash = `/detail/series/${series}/${encodeURIComponent(`${series}:${first}`)}`;
    }, { series, first });
    const sourceRequest = { id: `${series}:${first}`, include: process.env.TV_SOURCE_PATTERN || '1080',
      exclude: process.env.TV_SOURCE_EXCLUDE || '\\b(DV|Dolby)\\b' };
    await page.waitForFunction(async request => {
      const s = await (window.core || window.services?.core).getState('meta_details');
      if (s?.selected?.streamPath?.id !== request.id) return false;
      return (s.streams || []).some(g => g.content?.type === 'Ready' && g.content.content.some(st => {
        const text = `${st.name || ''} ${st.description || st.title || ''}`;
        return st.deepLinks?.player && new RegExp(request.include, 'i').test(text) && !new RegExp(request.exclude, 'i').test(text);
      }));
    }, sourceRequest);
    await page.evaluate(async request => {
      const s = await (window.core || window.services?.core).getState('meta_details');
      const stream = s.streams.filter(g => g.content?.type === 'Ready').flatMap(g => g.content.content).find(st => {
        const text = `${st.name || ''} ${st.description || st.title || ''}`;
        return st.deepLinks?.player && new RegExp(request.include, 'i').test(text) && !new RegExp(request.exclude, 'i').test(text);
      });
      location.hash = stream.deepLinks.player.replace(/^#/, '');
    }, sourceRequest);
    await page.waitForFunction(async id => {
      const s = await (window.core || window.services?.core).getState('player');
      return s?.selected?.streamRequest?.path?.id === id;
    }, `${series}:${first}`);
    const details = await page.evaluate(targetId => {
      const trace = value => console.log('[episode-check]', JSON.stringify(value));
      const route = () => location.hash.split('/')[1] || 'home';
      const closed = window.__dxbiTv.onClosed;
      window.__dxbiTv.onClosed = async (...args) => {
        const state = await (window.core || window.services?.core).getState('player');
        const video = state?.metaItem?.content?.videos?.find(v => v.id === targetId);
        trace({ event: 'closed', action: args[4], selected: state?.selected?.streamRequest?.path?.id,
          targetFound: !!video, playerLink: !!video?.deepLinks?.player,
          sourcesAreHashRoute: video?.deepLinks?.metaDetailsStreams?.startsWith('#/'),
          route: route() });
        try { await closed(...args); }
        catch (error) { trace({ event: 'close-error', name: error.name }); throw error; }
        trace({ event: 'close-complete', route: route() });
      };
      window.addEventListener('hashchange', () => trace({ event: 'route', route: route() }));
      window.addEventListener('beforeunload', () => trace({ event: 'unload', route: route() }));
      window.__episodeVerificationStamp = `${Date.now()}`;
      return (window.core || window.services?.core).getState('player').then(s => ({
        stamp: window.__episodeVerificationStamp, hasNext: !!s.nextVideo,
      }));
    }, `${series}:${target}`);
    await page.waitForTimeout(8000); // let controls hide so the remote starts from a known position
    assert(/mResumedActivity:.*PlayerActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities')), 'Initial native player did not open');
    adb('shell', 'input', 'keyevent', '19', '20', ...(details.hasNext ? ['22'] : []), '23');
    await page.waitForTimeout(500);
    // The panel starts on the current episode; support both directions within a season.
    const [season, episode] = first.split(':').map(Number);
    const [targetSeason, targetEpisode] = target.split(':').map(Number);
    assert.equal(targetSeason, season);
    assert.notEqual(targetEpisode, episode);
    adb('shell', 'input', 'keyevent', ...Array(Math.abs(targetEpisode - episode)).fill(targetEpisode > episode ? '20' : '19'), '23');
    await page.waitForFunction(async id => {
      const s = await (window.core || window.services?.core).getState('player');
      return s?.selected?.streamRequest?.path?.id === id;
    }, `${series}:${target}`, { timeout: 30000 });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !/mResumedActivity:.*PlayerActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities'))) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(await page.evaluate(() => window.__episodeVerificationStamp), details.stamp, 'Stremio reloaded');
    assert(/mResumedActivity:.*PlayerActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities')), 'Selected episode did not open in the native player');
    console.log(`PASS: native Episodes panel switched ${first} -> ${target}; player opened without reloading Stremio`);
  } finally { await browser.close(); }
})().catch(e => {
  console.error(e.message.replace(/https?:[^\s)]+/g, '<redacted-url>'));
  process.exitCode = 1;
});
