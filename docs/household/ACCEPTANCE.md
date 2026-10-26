# Public acceptance summary

This is a development source review, not a production release. Private test captures and account-specific evidence are omitted from the sharing package.

The source includes tests for profile isolation, local profile persistence, synthetic native playback, TV remote behavior, episode routing, backend authorization/import behavior, and desktop isolation. Test source is available so a reviewer can run the checks in a clean environment.

Build/lint and selected tests passed during development. Those runs do not establish that the sanitized export passes every platform build or real-account workflow.

The episode-selection lifecycle regression passes on the emulator and physical Shield, alongside 16 browser routing checks and four native series tests. See [EPISODE-RECREATION.md](EPISODE-RECREATION.md) for the failing-before/passing-after test.

The 0.1.12 navigation update passes two additional browser regressions and a controlled Shield navigation benchmark with ten injected D-pad moves. All six native navigation/series/lifecycle tests passed. See [TV-UI-PERFORMANCE.md](TV-UI-PERFORMANCE.md) for scope, timings, and measurement limits.

Open release gates include Dolby Vision parity with official Stremio, audio passthrough, all add-on and episode-transition combinations, long playback, complete cross-device resume, and mobile journey coverage. See [FORK-ADDITIONS.md](FORK-ADDITIONS.md) for scope and observed limits.

Use disposable accounts and synthetic viewing histories for review. Do not redistribute real profile storage, CSV history, playback URLs, credentials, or raw device logs.
