# Stremflix fork additions and review guide

This development fork extends [dx.bi](https://github.com/notdxbi/dxbi-stremio) at upstream commit `ac8469def67ccc5dcabbea123d023fcb5e380429`. It adds separate household profiles, TV navigation changes, native player controls, and an optional household service. The source retains the upstream MIT license and attribution.

This document describes changes present in the source snapshot. It does not claim complete Stremio Android TV player parity or a production-ready release.

## Two household modes

The standalone local mode keeps profile management on the device. Its Android TV build requires no Household server. Each viewer opens a separate Stremio session and signs in through Stremio's interface. The optional service mode adds server-managed profiles, metadata catalogs, history imports, recommendations, and device pairing. The local picker does not expose every service feature.

## Additions compared with upstream

| Area | Change | Main source locations |
| --- | --- | --- |
| Local profile picker | Bundled picker, named profiles, avatar colors, profile management, loading feedback, and protection against repeated OK opening multiple sessions | `shared/local/`, `tv/app/src/main/assets/local-native.js` |
| Android account isolation | A WebView profile for each viewer, a separate Household shell profile, account-binding checks, encrypted local records, and reset/delete cleanup | `LocalProfileStore.kt`, `ProfileCleanup.kt`, `SecureStore.kt`, `MainActivity.kt` |
| Desktop local profiles | Persistent Electron session partitions and a local profile controller/store alongside the optional server-backed launcher | `app/src/household/` |
| Profile switching | Profile controls in the Stremio header and return to the picker without requiring a new Stremio sign-in | `MainActivity.kt`, `tv/app/src/main/assets/dxbi-tv.js` |
| Android TV browsing | A cached row/grid index, direct row movement, visible CSS sort order, retained grid columns, See All navigation, and navigation through both Library filter rows | `dxbi.plugin.js` |
| Catalog loading during navigation | Cache each TV track independently so a late poster does not trigger a full-catalog visibility scan on the next arrow press | `dxbi.plugin.js`, [measurements](TV-UI-PERFORMANCE.md) |
| Held remote input | Repeated-key coalescing, an intentional transition from the top Library row to its filters, and deferred background sorting while the grid has focus | `dxbi.plugin.js` |
| TV rendering defaults | Fast TV browsing mode, instant navigation scrolling, fewer automatic visual/audio effects, and delayed previews after a title remains selected | `dxbi.plugin.js`, `dxbi.theme.css` |
| Native player series controls | Episodes panel, season navigation, Next Episode, Up Next, and binge-watching settings passed from Stremio | `SeriesPlayback.kt`, `PlayerActivity.kt`, `dxbi-tv.js` |
| Audio and subtitle controls | Native track selection, language preferences, subtitle presentation, subtitle timing, sound timing, and accelerated adjustment when OK is held | `TracksPanel.kt`, `AvSync.kt` |
| Playback feedback | Title/backdrop startup overlay, slow-start feedback, retry and source-selection actions, and remote focus rules for controls and panels | `activity_player.xml`, `PlayerActivity.kt` |
| Episode handoff work | Use Stremio's separate next-video playback link for manual selection of the next episode; otherwise attempt a source with the same add-on and binge group | `tv/app/src/main/assets/dxbi-tv.js` |
| Playback lifecycle recovery | Return episode selection through Android activity results and restore playback context after Android destroys the browsing activity | `MainActivity.kt`, `PlayerActivity.kt`, `dxbi-tv.js` |
| Launcher compatibility | Restore the `StremflixLauncher` activity alias so an existing TV launcher tile can still open the fork | `tv/app/src/main/AndroidManifest.xml` |
| Branding and application separation | Stremflix artwork and labels, separate application IDs/storage, and changes that prevent upstream app/plugin updates replacing the fork | `app/`, `tv/`, `dxbi.plugin.js`, `dxbi.theme.css` |

The renderer timings and episode handoff are custom integration work. They need further device testing. The presence of an Episodes button does not establish that every episode/source transition works.

## Optional household service

The service implementation adds:

- A FastAPI API, database models, Alembic migrations, a catalog worker, and container deployment with PostgreSQL and a TLS proxy.
- Administrator enrollment and login, rotating sessions, device pairing/revocation, profile permissions, and optional PIN checks in server mode.
- Profile preferences, feedback, watchlists, history, and metadata search.
- A Netflix CSV parser with normalized entries, candidate matching/review, batch removal, and export operations. It does not sign into Netflix or provide live Netflix synchronization.
- A deterministic recommendation ranker using preferences, history, feedback, metadata, and profile policies. It is not an LLM or a trained recommendation model.
- Provider allowlists and URL validation for metadata retrieval.
- Playback event sampling, profile-scoped synchronization records, ordering/conflict handling, and client outboxes. Complete cross-device resume remains unfinished.
- Backup/restore tooling and operation/privacy documentation.

The standalone local TV picker intentionally has no PIN gate or parental-control boundary. Server-mode child filtering must not be presented as protection for unrestricted local Stremio playback.

Sources are under `household/service/`, `household/migrations/`, `household/web/`, and `shared/stremio-adapter.js`.

## Import and development tools

`tools/household/export-netflix-simkl.py` prepares files offline for a later Simkl import. It separates explicit series labels from titles requiring review and protects CSV cells against formula interpretation. It does not upload histories or prove that a cloud provider matched the correct title.

The fork adds backend tests, desktop/browser tests, Android instrumentation, TV remote checks, episode-routing regressions, build scripts, and dependency-notice tools. The sharing snapshot uses neutral viewer fixtures and configurable device locations. Private histories and device captures are omitted.

## What remains from upstream

The original dx.bi plugin, theme, desktop application foundation, Android shell/player foundation, and existing browsing/media features remain credited to upstream. Features already present there, such as the original Netflix-style catalog presentation, are not claimed as new work in this fork. The patch and source manifest distinguish additions from modified upstream files.

## Validation and known gaps

Android builds and lint passed during development. All 16 browser episode-routing checks passed. Five native series/lifecycle tests passed on the emulator and physical Shield. Two additional browser tests cover navigation work, visual sorting, resized grids, and watched-title visibility. The lifecycle regression also passed on a physical Shield. It destroys the browsing activity while episode 10 is open, then selects episode 9 through the native Episodes panel. The same test failed against the previous APK at the expected episode-9 assertion. See [the lifecycle fix and reproduction](EPISODE-RECREATION.md).

The 0.1.12 UI pass also passed its Shield navigation fixture, including ten injected D-pad moves. See [the scoped performance result](TV-UI-PERFORMANCE.md).

These results establish the tested transitions and recovery behavior. They do not establish every add-on/source combination or HDR playback quality.

The following remain open:

- Dolby Vision does not yet match official Stremio on the reference Shield setup. Incorrect colors were observed with a Dolby Vision source. SDR playback rendered normal colors. Neither observation proves full HDR compatibility.
- Audio passthrough, Dolby Atmos/TrueHD, DTS formats, frame-rate matching, HDR profile coverage, and long playback sessions need an explicit hardware test matrix.
- Episode switching across all add-ons, arbitrary jumps across seasons, source matching, and long playback sessions require a broader hardware test matrix.
- The app still pins Media3 1.5.1. The enterprise-player research recommends comparing a current, unmodified Media3 baseline before choosing a replacement SDK.
- Cross-device resume, all phone journeys, and the complete optional Household product specification are unfinished.
- The sanitized source snapshot has not been rebuilt across every supported platform. Public release acceptance must use this exact snapshot and fresh credentials.

See [the player research](ANDROID-TV-ENTERPRISE-PLAYER-RESEARCH.md), [the product specification](SPEC.md), and [the public acceptance summary](ACCEPTANCE.md).

## Suggested upstream review order

The changes are suitable for separate reviews:

1. TV focus, visible sorting, row movement, and repeated-key handling.
2. Profile picker and account/session isolation.
3. Native player panels, timing controls, and startup/error feedback.
4. Episode transition and source-resolution work, with unresolved behavior called out.
5. Optional household service and history tooling.
6. Fork branding and distribution settings.

The source archive includes `UPSTREAM-CHANGES.patch` for text changes and `SOURCE-MANIFEST.json` for all exported files, including binary assets. It excludes local commit history and personal test evidence.
