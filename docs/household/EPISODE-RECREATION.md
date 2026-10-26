# Episode selection after Android reclaims browsing

## Failure

The native player remains in the foreground while Android can destroy the stopped browsing activity to reclaim memory. The old implementation delivered the episode choice through `PlaybackBus.listener`, which belonged to that activity. When playback closed, Android recreated browsing at its default URL. The choice was lost and the splash/Home screen appeared.

Physical-device lifecycle logs established this sequence. Quick episode switches passed because the original browsing activity was still alive.

## Correction in 0.1.11-local-tv

`PlayerActivity` returns its final progress, selected episode action, and private playback context through an Android activity result. `MainActivity` registers the result handler before creation and saves whether native playback is outstanding. A recreated activity waits for that result instead of loading Home.

The bridge restores the previous player model to record final progress, then resolves the selected episode. It suppresses the old native-player handoff and intro during recovery. The return context stays inside the app; it can include credential-bearing source links and must never be logged or included in sharing artifacts.

Current account identity is checked immediately before the next native handoff, so the recreated activity does not race the periodic identity check.

## Verification

`PlaybackRecreationTest.previousEpisodeSurvivesDestructionOfTheBrowsingActivity` uses a disposable profile, synthetic video, and intercepted metadata. It opens episode 10, pauses playback, recreates the stopped browsing activity, verifies that the original instance was destroyed, and selects episode 9 through the native Episodes panel. It checks that episode 9 opens and episode 10 is not launched a second time.

The same test failed against the previous APK at the expected episode-9 assertion and passed against the corrected APK. It also passed on the physical Shield. The four native series tests and all 16 browser routing checks passed. Android builds and lint passed.

Run the native regression on a test installation with:

```powershell
adb -s <device> shell am instrument -w -e class com.notdxbi.dxbi.tv.PlaybackRecreationTest org.dxbi.household.android.test/androidx.test.runner.AndroidJUnitRunner
```

The live TV script also supports backward selection within a season:

```powershell
node tools/household/check-tv-episode-switch.cjs <series-id> 3:10 3:9
```

These checks establish lifecycle recovery and the tested episode transitions. They do not establish Dolby Vision parity, every add-on's source matching, or full player acceptance.
