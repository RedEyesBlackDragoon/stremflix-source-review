const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('../../../app/node_modules/playwright');

// Exercise the shipped bridge in a browser, including native close -> route -> native play.
for (const choice of ['episode:s1e2', 'next']) {
  for (const prefix of ['', '#']) {
   for (const linkType of ['player', 'metaDetailsStreams', 'nextVideoOnly']) {
    test(`${choice} follows ${prefix || 'root-relative'} ${linkType} routes without restarting Stremio`, async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        let documents = 0;
        await page.route('https://web.stremio.com/**', route => {
          documents++;
          return route.fulfill({ contentType: 'text/html', body: '<html><head></head><body></body></html>' });
        });
        await page.goto('https://web.stremio.com/');
        await page.evaluate(({ prefix, linkType }) => {
          window.plays = [];
          window.sourceVisits = 0;
          window.DxbiTV = {
            profile: () => '{}', getSettings: () => '{}', pluginSource: () => '',
            play: json => window.plays.push(JSON.parse(json)),
          };
          window.fixtureState = {
            selected: { stream: { url: 'https://fixture.invalid/video.mp4' }, streamRequest: { path: { id: 's1e1' } } },
            stream: { type: 'Ready', content: { url: 'https://fixture.invalid/video.mp4' } },
            libraryItem: null,
            metaItem: { type: 'Ready', content: { name: 'Series fixture', videos: [
              { id: 's1e1', season: 1, episode: 1 },
              { id: 's1e2', season: 1, episode: 2, deepLinks: { [linkType === 'nextVideoOnly' ? 'metaDetailsStreams' : linkType]: prefix + (linkType === 'player' ? '/player/episode2' : '/detail/series/tt1234567/s1e2') } },
            ] } },
          };
          window.fixtureState.nextVideo = window.fixtureState.metaItem.content.videos[1];
          if (linkType === 'nextVideoOnly') window.fixtureState.nextVideo = {
            ...window.fixtureState.nextVideo, deepLinks: { player: prefix + '/player/episode2' },
          };
          window.core = { getState: async name => name === 'player' ? window.fixtureState : {}, dispatch: () => {} };
          // Minimal router: moving to episode sources must stay inside this document.
          window.addEventListener('hashchange', () => {
            if (location.hash === '#/player/episode2') window.fixtureState.selected.streamRequest.path.id = 's1e2';
            if (location.hash === '#/detail/series/tt1234567/s1e2') {
              window.sourceVisits++;
              window.fixtureState.selected.streamRequest.path.id = 's1e2';
              location.hash = '/player/episode2';
            }
          });
        }, { prefix, linkType });
        await page.addScriptTag({ path: path.resolve(__dirname, '../../../tv/app/src/main/assets/dxbi-tv.js') });
        await page.evaluate(() => { location.hash = '/player/episode1'; });
        await page.waitForFunction(() => window.plays.length === 1);
        await page.evaluate(choice => window.__dxbiTv.onClosed(5000, 60000, false, null, choice), choice);
        await page.waitForTimeout(300);
        assert.equal(documents, 1, 'Episode switch reloaded Stremio instead of using its hash router');
        await page.waitForFunction(() => window.plays.length === 2, null, { timeout: 3000 });
        assert.equal(await page.evaluate(() => window.plays[1].series.current), 's1e2');
        assert.equal(await page.evaluate(() => window.plays.length), 2, 'Exactly one handoff per episode');
        if (linkType === 'nextVideoOnly') assert.equal(await page.evaluate(() => window.sourceVisits), 0,
          'Manual next-episode selection must use Stremio’s matching player link');
      } finally { await browser.close(); }
    });
   }
  }
}

for (const match of ['same-source', 'different-group', 'different-addon']) {
  test(`arbitrary episode switch: ${match}`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('https://web.stremio.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<html><head></head><body></body></html>',
      }));
      await page.goto('https://web.stremio.com/');
      await page.evaluate(match => {
        window.plays = [];
        window.DxbiTV = { profile: () => '{}', getSettings: () => '{}', pluginSource: () => '',
          play: json => window.plays.push(JSON.parse(json)) };
        const addon = 'https://addon.invalid/manifest.json';
        const videos = [1, 2, 3].map(e => ({ id: `s1e${e}`, season: 1, episode: e,
          deepLinks: { player: null, metaDetailsStreams: `#/detail/series/tt1234567/s1e${e}` } }));
        const player = {
          selected: { stream: { url: 'https://fixture.invalid/video.mp4', behaviorHints: { bingeGroup: '1080p' } },
            streamRequest: { base: addon, path: { id: 's1e1' } } },
          stream: { type: 'Ready', content: { url: 'https://fixture.invalid/video.mp4' } },
          libraryItem: null, metaItem: { type: 'Ready', content: { name: 'Fixture', videos } },
          nextVideo: videos[1],
        };
        const source = { behaviorHints: { bingeGroup: match === 'different-group' ? '4k-dv' : '1080p' },
          deepLinks: { player: '#/player/episode3' } };
        const groups = [{ addon: { transportUrl: addon }, content: { type: 'Ready',
          content: match === 'different-addon' ? [] : [source] } }];
        if (match === 'different-addon') groups.push({ addon: { transportUrl: 'https://other.invalid/manifest.json' },
          content: { type: 'Ready', content: [source] } });
        window.core = { dispatch: () => {}, getState: async name => name === 'player' ? player : name === 'meta_details' ? {
          selected: { streamPath: { id: 's1e3' } }, streams: groups,
        } : {} };
        window.addEventListener('hashchange', () => {
          if (location.hash === '#/player/episode3') player.selected.streamRequest.path.id = 's1e3';
        });
      }, match);
      await page.addScriptTag({ path: path.resolve(__dirname, '../../../tv/app/src/main/assets/dxbi-tv.js') });
      await page.evaluate(() => { location.hash = '/player/episode1'; });
      await page.waitForFunction(() => window.plays.length === 1);
      await page.evaluate(() => window.__dxbiTv.onClosed(5000, 60000, false, null, 'episode:s1e3'));
      if (match === 'same-source') {
        await page.waitForFunction(() => window.plays.length === 2);
        assert.equal(await page.evaluate(() => window.plays[1].series.current), 's1e3');
      } else {
        assert.equal(await page.evaluate(() => location.hash), '#/detail/series/tt1234567/s1e3');
        assert.equal(await page.evaluate(() => window.plays.length), 1, 'Never auto-play a different source or video format');
      }
    } finally { await browser.close(); }
  });
}

test('backward episode choice survives a destroyed browsing document', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://web.stremio.com/**', route => route.fulfill({ contentType: 'text/html',
      body: '<html><head></head><body></body></html>' }));
    await page.goto('https://web.stremio.com/#/player/episode10');
    await page.evaluate(() => {
      window.plays = [];
      const addon = 'https://addon.invalid/manifest.json';
      window.__dxbiTvPendingClose = { timeMs: 20000, durationMs: 60000, ended: false, error: null,
        then: 'episode:s3e9', context: { hash: '#/player/episode10', current: 's3e10', next: null,
          metaId: 'tt1234567', type: 'series', addon, group: '1080p' } };
      window.DxbiTV = { profile: () => '{}', getSettings: () => '{}', pluginSource: () => '',
        play: value => window.plays.push(JSON.parse(value)) };
      const videos = [9, 10].map(e => ({ id: `s3e${e}`, season: 3, episode: e,
        deepLinks: { player: null, metaDetailsStreams: `#/detail/series/tt1234567/s3e${e}` } }));
      window.core = { dispatch: () => {}, getState: async name => name === 'player' ? {
        selected: { stream: { url: 'https://fixture.invalid/video.mp4', behaviorHints: { bingeGroup: '1080p' } },
          streamRequest: { base: addon, path: { id: location.hash === '#/player/episode9' ? 's3e9' : 's3e10' } } },
        stream: { type: 'Ready', content: { url: 'https://fixture.invalid/video.mp4' } }, libraryItem: null,
        metaItem: { type: 'Ready', content: { name: 'Fixture', videos } }, nextVideo: null,
      } : name === 'meta_details' ? { selected: { streamPath: { id: 's3e9' } }, streams: [
        { addon: { transportUrl: addon }, content: { type: 'Ready', content: [
          { behaviorHints: { bingeGroup: '1080p' }, deepLinks: { player: '#/player/episode9' } },
        ] } },
      ] } : {} };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../../tv/app/src/main/assets/dxbi-tv.js') });
    await page.waitForFunction(() => window.plays.length > 0);
    assert.equal(await page.evaluate(() => window.plays[0].series.current), 's3e9',
      'A restored browsing screen must play the chosen previous episode, not restart the old episode or Home');
  } finally { await browser.close(); }
});
