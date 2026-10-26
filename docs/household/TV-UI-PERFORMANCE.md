# TV navigation performance in 0.1.12

This pass reduces remote-navigation work while catalogs load. It does not establish Netflix UI parity or a display-frame performance result.

## Change

Previously, a poster arriving in any catalog invalidated the complete navigation index. The next arrow press checked every poster again. The TV index now caches each track independently. Catalog arrivals invalidate the changed track. Resize, route changes, sorting, and settings changes clear the relevant caches. Watched-title visibility changes also invalidate their track.

The cache uses weak keys so detached tracks do not become a permanent catalog registry. Focus behavior and source/player behavior remain covered separately.

## Shield diagnostic result

The controlled fixture contains 40 rows of 20 posters. Another poster arrives in the last row before each arrow press between the first two rows. Each run checks 30 expected focus moves, then verifies poster insertion/removal and whole-row insertion/removal. An additional check sends ten Android D-pad events through the displayed WebView.

Five alternating baseline/candidate runs on the physical Shield produced:

| Diagnostic | Baseline | Candidate |
| --- | --- | --- |
| Median of the five per-run median handler times | 9.9 ms | 5.1 ms |
| Range of per-run medians | 9.5-10.2 ms | 4.9-5.2 ms |
| Maximum visibility checks for a warm move | 870 | 90 |
| Correct timed focus moves | 150/150 | 150/150 |
| Catalog-change checks | 20/20 | 20/20 |

The additional ten injected D-pad moves passed. The browser regression failed on the baseline because warm navigation exceeded the visibility-work budget, then passed after the change. A separate browser test covers visual CSS ordering, column changes, hidden posters, and watched-title visibility changes.

These are measurements of JavaScript handler work in a diagnostic WebView build, with synthetic cards and no external network or artwork. They include DOM focus and synchronous scrolling, but exclude physical remote transport, image decode, subsequent rendering, and television presentation. They are not a claim of halved total input latency, improved FPS, or a Netflix comparison. Both sides execute inside the same app/WebView and alternate to limit drift. The limiting work addressed here is poster visibility scanning and navigation-index rebuilding; scrolling/layout and other UI handlers remain.

The optimized app builds and launches. Running the existing instrumentation runner against its shrunk classes encountered test-runner dependency failures before the benchmark started. Those attempts supply no release timing evidence. The final installation uses the optimized `shield` variant.

## Repeat the checks

Preserve a baseline plugin before changing it. The public review snapshot at commit `fc4191e088135985eaa37d8cc21daf9a99fbe4c9` contains the baseline used here.

```powershell
node --test tools/household/tests/tv-navigation-performance.cjs
node tools/household/benchmark-tv-navigation.cjs <baseline-plugin> dxbi.plugin.js
node tools/household/benchmark-tv-navigation.cjs --prepare-android <baseline-plugin>
```

The preparation command writes only generated test assets under `tv/build/`. It does not change the installed app or include those assets in production APKs. Build the debug app and test APK, then install both with `adb install -r` using the same signing key. Do not clear viewer data or use a connected-test task that uninstalls the app.

```powershell
cd tv
.\gradlew.bat assembleDebug assembleDebugAndroidTest
adb -s <device> shell am instrument -w -e navigationBenchmark true -e class com.notdxbi.dxbi.tv.TvNavigationBenchmarkTest org.dxbi.household.android.test/androidx.test.runner.AndroidJUnitRunner
```

Without `navigationBenchmark=true`, the optional hardware benchmark skips before loading its generated assets. The fixture uses a separate reserved origin and never reads viewer accounts or playback URLs. The native episode-selection lifecycle regression and four series tests also passed on the Shield after the change. Android build/lint and all 18 browser episode/navigation checks passed.

## Further UI acceptance

The next measurements must cover launch to usable posters, real input to a presented focus frame, artwork loading during row movement, return-from-details focus and scroll restoration, and memory across long browsing/playback cycles. Track failures alongside timings. Use equivalent optimized artifacts for adoption decisions.

The development repository's `TV-QUALITY-BASELINE.md` describes the broader measurement requirements. Its original device observations are historical, not the current installed version. HDR/Dolby Vision output remains a separate unresolved playback requirement.
