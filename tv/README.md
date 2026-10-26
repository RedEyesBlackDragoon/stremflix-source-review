# dx.bi TV

dx.bi for Android TV, Google TV and Fire TV (Fire OS). For what it does and how to install it, see the [main README](../README.md#dxbi-tv-android-tv-google-tv-and-fire-tv).

How it works:

- `MainActivity` shows Stremio's web app (web.stremio.com) in a WebView laid out 1280 CSS pixels wide, with a desktop browser's identity plus `dxbi-tv/<version>` (the plugin recognises it and switches to its TV mode).

- `assets/dxbi-tv.js` runs in the page before Stremio's own scripts. It stands in for Stremio Enhanced's plugin API (settings, alerts, prompts), loads the dx.bi plugin, adds a remote-friendly *dx.bi settings* entry to Stremio's Settings, and handles the remote's Back button.

- Playback: when Stremio opens its player, the stream (with its headers, subtitles and saved position) is handed to `PlayerActivity`, a Media3/ExoPlayer player. Stremio's player screen stays underneath, silent, and gets `TimeChanged` / `PausedChanged` / `Ended` from the native player, so Continue Watching and watched marks work as usual.

- The dx.bi plugin is the one at the repository root, copied in at build time. `Updates` keeps a newer copy from GitHub between app releases, and offers new app releases (downloaded and handed to Android's installer).

- Torrents need a Stremio streaming server elsewhere on the network (Settings → Streaming); debrid streams play directly.

## Building

Needs JDK 17 or 21 and the Android SDK (platform 35).

```sh
cd tv
./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease          # signed when tv/keystore.properties (or the DXBI_TV_* variables) exist
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug builds can be inspected from `chrome://inspect` on a computer. `tv/keystore.properties` (not in git) points at the release key:

```
storeFile=/path/to/dxbi-tv-release.jks
storePassword=…
keyAlias=dxbi-tv
keyPassword=…
```

Keep that key safe: every update must be signed with the same one, or Android won't install it over the old version. Publishing a release builds `dxbi-tv.apk` on GitHub when the key is in the repository's secrets (see `.github/workflows/tv.yml`).
