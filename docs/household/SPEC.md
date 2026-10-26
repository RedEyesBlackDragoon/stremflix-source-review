# STREMFLIX Household Edition — Product & Engineering Specification

**Status:** Implementation-ready target specification  
**Version:** 1.0 | **Date:** 2026-10-25  
**Primary target:** NVIDIA Shield / Android TV  
**Other targets:** Google TV, Android phones/tablets, Windows  
**Base project:** `notdxbi/dxbi-stremio` (fork, preserving MIT attribution)  
**Reference projects:** `TimilsinaBimal/Watchly`, `Br0ck25/My-Lists`, `Joshuabastiaans/stremio-for-you`  
**Operating model:** Engineer/coding agent owns architecture, implementation, tests, builds, debugging, and documentation. The owner supplies credentials, hardware access, and subjective acceptance only when unavoidable.

## 0. Executive directive

Build an installable, maintainable, household-focused streaming client that retains DX.BI's Stremio compatibility and native playback, while offering a polished, Netflix-like experience. The intended everyday interaction is **turn on TV → choose profile → browse relevant titles → press Play → watch**. No household member should need to understand Stremio, addons, stream providers, or the implementation in order to browse or watch. Advanced settings are administrator-only. The system must make the experience *feel* like a first-class streaming app without copying Netflix trademarks or protected assets.

Each household profile maps **one-to-one to its own free Stremio account**. This is an approved architectural decision, not an option requiring clarification. Per-profile Stremio accounts are the source of truth for that person's Stremio library, addons, and Stremio-native playback history; the Household service adds Netflix history, personalized ranking, feedback, curation, preferences, and device linkage. No Stremio Supporter subscription is a dependency. Different accounts must never share authentication state. The product may initially show named example profiles, but ship with no real people, credentials, Netflix data, or secrets embedded.

Implement the complete scope below. Do not stop at mockups, a design document, a dashboard, or a proof of concept. Do not present a plan in place of an installable application. When a third-party API or device capability is not available, implement the specified secure degradation behavior and document the constraint; do not invent a working integration.

## 1. Nonnegotiable product principles

1. **TV-first:** Design and test remote-first on NVIDIA Shield. Directional navigation must work without mouse, keyboard, or touch input.
2. **Low-friction viewing:** Normal use starts at profile selection or the last permitted profile; it does not expose addon settings or error stack traces.
3. **Genuine isolation:** Distinct Stremio accounts, WebView/Electron sessions, personal libraries, watched states, recommendations, and local device preferences. Shared household configuration must never silently merge history.
4. **Cross-device continuity:** One profile follows the viewer across supported devices. Stremio-native progress remains synchronized via that person's Stremio account; household-specific data synchronizes via the Household backend.
5. **Graceful operation:** Partial outages, missing metadata, inaccessible addons, and an offline Household backend never blank the entire home screen or break otherwise functional Stremio playback.
6. **Explanations over black boxes:** Show understandable recommendation rationales; support Like, Dislike/Not Interested, Hide, and undo.
7. **User control and privacy:** No advertising, account-data resale, covert tracking, unauthorized scraping, automatic Netflix login, or transmission of viewing histories to an LLM.
8. **Preserve upstream strengths:** Keep DX.BI's Media3 player, subtitles, playback integration, and Windows streaming-server functionality unless a verified defect requires a minimal change.
9. **Maintainability:** No brittle one-off DOM hacks when a stable application adapter is possible. Encapsulate unavoidable hooks, version-check them, and test them.
10. **Accurate representations:** Community collections, popularity charts, and algorithmic picks must have clearly distinguishable provenance. A title's presence in a recommendation list does not imply an available legal stream.

## 2. Device and deployment targets

| Target | UI / playback requirements |
|---|---|
| **NVIDIA Shield** (reference) | Landscape 10-foot UI, D-pad, OK, Back, Play/Pause, long lists, 1080p/4K output as supported; maintain Media3/ExoPlayer compatibility and passthrough/HDR subject to hardware/stream capability. |
| Android TV / Google TV | Equivalent lean-back app, launcher icon, D-pad focus and lifecycle handling. |
| Android phones/tablets | Genuine adaptive phone/tablet layout, touch gestures, orientation changes, system Back, notification/audio focus, Media3 player; do **not** ship the fixed-width TV WebView as the mobile experience. |
| Windows 10/11 x64 | Existing Electron foundation, keyboard, mouse, controller-friendly navigation where possible, signed installer if signing is configured, otherwise clearly labeled development build; preserve local Stremio streaming server behavior. |

Do not claim universal Android compatibility until hardware and emulator tests prove it. Phone support is a new implementation requirement: upstream currently supports Android TV, not phones. Version the TV/mobile package variants intentionally; use a new application ID/branding for this fork so release keys and updates cannot conflict with upstream.

**Backend:** Deployable as containers on an always-on host, with PostgreSQL as the persistent store and a Python/FastAPI service plus job worker. Redis is optional for queue/cache acceleration, not the only copy of user data. Provide `docker compose` for local testing and production documentation for a reachable HTTPS endpoint with persistent storage, backups, and TLS. All cross-network synchronization requires a reachable backend; a development PC that is switched off cannot provide always-on sync. Local playback must remain possible when Household backend is down. The software must allow household-private hosting and must not require a commercial hosted account.

## 3. Required user experiences

### 3.1 First-run administrator setup

- Clean launch displays a branded welcome screen and **Set Up Household**. Provide a secure bootstrap admin enrollment, then create household profiles (name, avatar, adult/kids flag, optional profile PIN).
- **Link Stremio Account** opens the genuine Stremio sign-in surface in that profile's isolated session. Do not ask for or store Stremio passwords in the Household backend.
- After login, verify account identity via an authenticated, supported Stremio client flow and store only the stable Stremio account identifier needed for the mapping. Refuse to bind the same Stremio identity to multiple household profiles unless the administrator explicitly resolves the conflict; default is one-to-one.
- Present an import option for each person's Netflix CSV. Skip is supported; app still works and recommendations use Stremio history and available catalogs.
- On a fresh Stremio account, clearly explain that metadata catalogs may be present but playback depends on user-installed lawful sources. Do not auto-install streaming addons or solicit third-party service credentials.
- A TV user can complete sign-in with a remote. If a supported secure browser/device flow is unavailable, show a QR/deep link to a phone-assisted authenticated process bound to the selected profile and expire the handoff promptly. Never display or log passwords.
- Pair Windows/mobile devices through expiring, single-use QR or short-code flow approved by the administrator. Device names and revocation are managed in Admin Settings.

### 3.2 Profile picker and switching

- “Who's Watching?” presents avatars, names, an Add Profile control visible only after admin unlock, and an accessible focus indicator.
- Switching profiles saves playback progress, stops the previous stream, clears ephemeral player/stream state, swaps to the new account's isolated session, and restores the new person's preferences and library. Do not silently carry over stream links, addon tokens, subtitles, history, search suggestions, or viewing events.
- Optional **last profile** preference is disabled for kid profiles unless the administrator enables it. Admin PIN is required for profile changes, settings, export, or deletion where policy specifies.
- If the account cannot be restored, show a friendly **Reconnect Stremio** action for that profile. Never fall back to another household member's account.

### 3.3 Home screen (per-profile)

Visible, configurable rows: **Continue Watching**, **Top Picks for You**, **Because You Watched [title]**, **New Episodes**, **Your List**, **Hidden Gems**, **Trending**, **Community Favorites**, **Discover Something Different**, plus genre/actor/director collections when meaningful. Display only rows with usable data; default ordering favors Continue Watching and Top Picks; permit admin row arrangement. Loading skeletons have bounded duration and meaningful offline states.

Each card provides title, art, genre/year, maturity label, progress if relevant, and a simple More Info route. Each detail page provides **Play/Resume**, **Episodes**, **Add/Remove My List**, **Like**, **Not Interested**, **Trailer** (when supported), synopsis, cast, and recommendation rationale. Show stream selection only when needed. Never autoplay a full movie or an unexpected preview with sound while navigating.

### 3.4 Find and browse

- Search across configured Stremio metadata providers with tolerant spelling; group movies, series, people where supported, and personal library results. No results must have a useful empty state.
- Discover filters: movies/series, genres, release period, language, runtime, age rating, popularity, unwatched, available metadata provider. Preserve filters while returning from details.
- Do not let a single addon outage block all search results. Deduplicate by canonical work identity.

### 3.5 Playback and Continue Watching

- Retain DX.BI's Stremio stream-provider pathway and Android Media3/ExoPlayer handoff. Retain subtitles, skip controls, next episode, playback progress, and robust error recovery subject to platform support.
- **Play** resumes when prior position is meaningful; **Play From Start** is explicit. Next Episode opens the correct season/episode; series progress is tracked per episode, not only per series.
- Progress heartbeats: every 15 seconds while genuinely playing, on pause/seek/background, on completion, and before profile switch. Do not count paused/buffering intervals as watched. Use idempotent event identifiers to avoid duplicates.
- “Completed” threshold: >=90% for movies, >=85% for episodes, unless underlying Stremio completion semantics require a compatible mapping; test and document any differences. Completed titles leave Continue Watching unless a later replay is started.
- Prefer the profile's native Stremio progress when freshly available; reconcile by content identity, playback session ID, timestamps, and completion status. A stale device heartbeat must never rewind a more recently completed title. Divergent active sessions must use deterministic conflict handling and an explicit resolution action if irreconcilable.
- A TV should be usable with only the standard remote. Long Back press or repeated Back must not accidentally exit and lose playback state.
- One-tap Play may auto-select only previously approved, compatible, lawful stream sources under an opt-in policy; otherwise show a minimal, clearly named source picker. Never invent source availability.

## 4. Stremio integration and session isolation

Each household profile owns exactly one Stremio account binding. Stremio handles its account-specific addons, library, and watch progress; Household never assumes that Stremio has native multi-profile support on the same login. The account binding is independent of Household authentication.

Implement `StremioAdapter` interfaces for account identity, library reads/edits, progress reads/events, metadata catalog retrieval, addon catalog retrieval, stream resolution, and sign-out. Inspect the forked source and use existing supported runtime paths; do **not** assume undocumented endpoints are stable. Maintain fixtures and compatibility tests against the supported DX.BI/Stremio web versions.

**Android isolation:** first use `androidx.webkit.WebViewCompat.setProfile(webView, profileUuid)` when `WebViewFeature.MULTI_PROFILE` is supported, assigning it before first WebView navigation or JavaScript evaluation. This supports isolated cookies and web storage. Confirm behavior on actual Shield System WebView builds. If unsupported, use an independently verified per-profile process/data-directory isolation or a safe explicit reauthentication workflow—**never reuse a shared authenticated WebView**. Account leakage is a release-blocking defect.

**Windows isolation:** use distinct persistent Electron `session` partitions for each profile, each with its own cookies, storage, cache, and permissions. Never reuse a BrowserWindow session partition between accounts. Close player/auxiliary windows and scrub ephemeral tokens when switching. Verify no addon configuration is copied to another Stremio identity.

**Android mobile isolation:** use the same supported per-profile WebView mechanism or a native account-session abstraction with demonstrated account separation. Mobile-specific view and playback cannot assume TV CSS viewport or D-pad interaction.

Do not proxy stream links, auth tokens, or debrid keys to the Household backend. Provider credentials should remain within the individual Stremio client session. The Household backend receives sanitized viewing events and catalog identifiers, not playback URLs or service access tokens. Where Stremio playback works but syncing fails, allow playback and queue local events for later upload.

## 5. Netflix viewing history import

Per-profile **Import Netflix History** accepts a CSV downloaded from that Netflix profile's Viewing Activity page. Support Netflix's documented export, quoted commas, UTF-8/BOM, common date formats, localized titles where resolvable, duplicates, and episodic rows. Offer an advanced importer for fuller personal-data exports only after actual schema fixtures are validated—never claim that ratings or My List are present when absent.

Pipeline:
1. Select the household profile and upload a CSV through Android system file picker, Windows file picker, or authenticated admin web UI.
2. Parse in a restricted worker with file size/row limits and CSV-injection-safe export handling; reject executable/archive payloads unless an explicitly implemented archive parser validates members.
3. Normalize dates/timezone and separate movie titles from probable `Series: Season/Episode` values without assuming delimiters are universal.
4. Resolve works through a `MetadataResolver` against permitted catalogs, TMDB/IMDb crosswalk, and title/year/language candidate scores. Record matching confidence and provenance; never map uncertain titles silently.
5. Present a review queue for ambiguities and unmatched titles with **Confirm**, **Search**, **Skip**. Import unambiguous entries without manual interaction; show imported/matched/needs-review/skipped counts.
6. Persist source-event ID/hash, profile ID, canonical title ID, optional season/episode ID, watched date, provenance=`netflix_import`, and match state. Repeated imports are **idempotent** and incremental. A movie watched multiple times is represented by distinct genuine dated events, not duplicated by reimport.
7. Import contributes to recommendations and **Watched History** only; it does **not** fabricate Stremio playback positions or upload imported Netflix watches to the Stremio account by default. A clearly labeled opt-in backfill may be implemented only if the supported Stremio API safely permits it.
8. Allow removing one import batch, deleting an individual mapping, and exporting all profile-specific imported data.

Netflix history is an implicit interest signal, **not** proof that the user enjoyed a title. Watching one episode does not establish completion of an entire series. Do not attempt Netflix credential scraping or automatic account login. Ongoing Netflix viewing is updated by a later reimport or an explicitly authorized supported third-party integration; absent such an integration, never claim real-time Netflix synchronization.

## 6. Recommendation engine

**Architecture:** deterministic, explainable, hybrid content-based ranking with optional community signals. Start with a self-hostable internal recommender. Review Watchly's MIT-licensed code and reuse useful algorithms/adapters where technically and legally suitable, but never depend exclusively on a publicly hosted third party, and do not assume an unmodified Watchly manifest accepts Netflix imports. Store profile-specific preference state in Household, not in public addon URLs. The system may expose its own compatible Stremio `catalog` addon for interoperability; it is not required for the custom DX.BI UI.

**Inputs, ordered by evidence strength:** explicit Like/Dislike/Not Interested; rated items where permitted; repeat completions; ordinary Stremio completions; imported Netflix viewing events; recently started titles; My List saves; opt-in curated/community affinity. Recently watched is a short-term preference, not the entire taste profile. Non-completion alone is weak negative evidence; buffering/stream failure is *never* negative preference evidence.

**Candidate retrieval:** recommendations based on recent titles, shared genre/keyword/crew/cast and related works, new seasons, curated-list intersections, popular/unwatched catalog items, controlled exploration, and optional Watchly catalogs. Deduplicate and normalize IDs. Default to exclude watched movies; for series exclude watched episodes without suppressing new seasons/episodes. Enforce kid-profile maturity filters before ranking. Preserve release/localization constraints. Remove Not Interested titles and blocked genres.

**Ranking:** produce an auditable feature vector (short-term similarity, long-term taste affinity, explicit feedback, freshness, catalog quality, novelty/diversity, community relevance) and a versioned deterministic scoring function; document default weights in code/config with tests. Do not claim scientifically optimized weights. Use diversity constraints to prevent endless near-duplicates and monotony, and reserve limited space for credible unfamiliar picks. Display human-readable reasons based on actual contributing signals only. A new watched title should cause an explainable refresh without erasing long-term preferences.

**Refresh and performance:** update profile recommendations within 15 minutes of a completed title or feedback action when backend is healthy; support immediate refresh from UI. Allow scheduled candidate/cache refresh with expiration, external-provider rate limits, exponential backoff, and last-known-good snapshots. Render cached home content immediately if still usable. A per-profile cache key must include profile ID, algorithm version, locale, maturity policy, source configuration, and relevant preference revision. Tests must prove profile A's cache never populates profile B's output.

**Cold start:** with no history, offer genre selection and trusted popular/community catalog rows; do not infer personal preferences or fabricate a rating. As history accumulates, progressively replace generic rows with tailored ones.

**Licensing constraint:** comply with each metadata provider's usage terms. TMDB metadata may be used for normal display/discovery subject to attribution and license; do not train an ML model on TMDB API content or deploy an ML-based use of TMDB content without required permissions. If licensing constraints preclude a feature, keep the transparent deterministic/rule-based alternative and document the limitation. Keep model/embedding providers optional and off by default.

## 7. Community and curated discovery

Provide a first-class **Community** tab and optional home rows. Sources are pluggable `CuratedListProvider`s, starting with compatible catalogs from My Lists, Stremio list addons, MDBList, Trakt, and publicly accessible Letterboxd-derived lists only where supported by authorized APIs/exports and source terms. Don't scrape logged-in sites, misrepresent rankings, or bundle a third-party source's credentials. Support manually added Stremio catalog manifest URLs after manifest/schema validation and an admin-controlled allowlist.

UI collections: **Community Favorites**, **Cult Classics**, **Underappreciated Movies**, **Curator Picks**, **Because You Like [genre]**, **Recently Popular**. Labels must be backed by real list provenance, not invented rankings. Show curator/source, last refresh, collection description, and an **Original Order / Ranked for Me** toggle. Personalized mode ranks entries *within the same curated list* without changing or falsely attributing the curator's original order. Allow Save Collection, Hide Source, Report Broken List. Prefer metadata identifiers and links, not complete third-party text reproduction. Deduplicate across providers.

If a curated provider goes offline, show last-known-good cached results with staleness indication, or hide the row; don't hang Home. Kids profiles receive only filtered, age-appropriate items; unrated items are excluded by default. Community suggestions should be useful without community sign-in.

## 8. Household backend and canonical data model

Implement versioned REST API with OpenAPI 3 documentation, client-generated event IDs, idempotent writes, authorization at household/profile scope, and background workers. Recommend Python 3.12+, FastAPI, SQLAlchemy/Alembic, PostgreSQL, and optional Redis; this is the selected default unless an existing project dependency makes an equivalent clearly superior. Do not introduce multiple backend languages without demonstrable need.

Minimum relational entities (UUID IDs, timestamps and migrations for all):

- `households`: settings, owner principal, account state.
- `profiles`: household ID, display name, avatar reference, adult/kid flags, maturity policy, optional hashed PIN, recommendation settings.
- `profile_stremio_bindings`: profile ID, Stremio user ID, verification time, status; unique binding constraints; **no Stremio password**.
- `devices`: household ID, platform, display name, capability flags, pairing/revocation, last seen.
- `device_profile_sessions`: device/profile association, last active time, revocable session metadata, never raw third-party secrets.
- `media_works`: canonical internal ID, type, title/year, metadata provenance and freshness; provider IDs held in `media_external_ids` with unique `(provider, external_id)`.
- `episodes`: work ID, season and episode identifiers, optional absolute episode code.
- `watch_events`: profile ID, work/episode IDs, source, occurred time, event type, playback session, progress duration, device ID, source-event ID/hash and idempotency key.
- `playback_states`: canonical per-profile work/episode, position, duration, completed flag, last authoritative update, version.
- `watchlist_entries`, `feedback_events` (like/dislike/hide with undo), `profile_preferences`, `library_sync_checkpoints`.
- `import_batches`, `import_rows` (original normalized input, match confidence, status, mapping decisions; raw file retention disabled by default).
- `curated_sources`, `curated_lists`, `curated_list_items` (source, attribution, fetch timestamps, original rank).
- `recommendation_snapshots`, `recommendation_items` (rank, algorithm version, source features, rationale, computed time).
- `audit_events` for profile/account/device administrative changes, with no secrets, passwords, URLs containing credentials, or raw private histories in logs.

Constraints: unique `(profile_id, source, source_event_id)` when available; transactional updates; foreign keys; index profile+time and profile+canonical media IDs; row-level household authorization in every query; export/delete cascades with explicit audit policy. Raw passwords and stream URLs are never valid database columns.

Illustrative API surface (exact route names may follow the chosen router conventions):

- `POST /v1/admin/bootstrap`, `POST /v1/auth/pair/start`, `POST /v1/auth/pair/complete`, `POST /v1/auth/refresh`, `POST /v1/auth/revoke`
- `GET/POST /v1/profiles`, `PATCH/DELETE /v1/profiles/{id}`, `POST /v1/profiles/{id}/pin/verify`, `POST /v1/profiles/{id}/stremio-binding`
- `GET /v1/profiles/{id}/home`, `/recommendations`, `/history`, `/watchlist`, `/preferences`; `PUT` for preferences; `POST` for feedback/events.
- `POST /v1/profiles/{id}/imports/netflix`, `GET /v1/imports/{batchId}`, `POST /v1/imports/{batchId}/resolve`, `DELETE /v1/imports/{batchId}`
- `GET /v1/community/lists`, `GET /v1/community/lists/{id}`, `POST /v1/profiles/{id}/community-preferences`
- `POST /v1/sync/events`, `GET /v1/sync/changes?cursor=`, `GET /v1/health`, `GET /v1/ready`.

Use pagination/cursors, validation, structured error codes, ETags or resource versions for conflict-prone mutations, documented retry semantics, and optimistic UI when appropriate. Endpoints returning profile data require both an authenticated device/household principal **and** membership/authorization for that profile; profile ID alone is not authority.

## 9. Frontend architecture and UX requirements

Preserve DX.BI's JS styling and Stremio rendering where stable, but isolate enhancements into maintainable modules and shared type-safe client contracts: `ProfileManager`, `StremioAdapter`, `HouseholdAPI`, `HomeComposer`, `RecommenderClient`, `CommunityClient`, `ImportUI`, `PlaybackSync`, `FocusManager`, `Telemetry` (local-only by default). Avoid adding an entire second app underneath the WebView just to implement tabs.

Use a shared presentation/domain layer wherever practical, with `tv` (focusable lean-back), `mobile` (touch-responsive), and `desktop` (mouse/keyboard) adapters. A responsive application is not the same as scaling a TV viewport to a phone. Keep layout, imagery, and typography legible from a living-room distance, with safe areas, overscan, reduced motion, subtitles accessibility, dynamic text sizing, screen-reader labels, and clear color contrast.

**TV navigation contract:** Up/Down moves between rows/controls; Left/Right moves within rails; OK opens; Back closes modal/details or returns to the prior focus position; long rails preserve scroll position; profile icon is reachable using only directional keys; no invisible focus traps. Restore focus after dialogs and returning from playback. All settings have a TV-remote path, but technical configuration is hidden behind Admin Settings. Avoid infinite spinners and accidental focus jumps as images lazy-load.

**Mobile navigation:** bottom navigation or equivalent with Home, Search, Community, My List, Downloads only if actually implemented (otherwise omit); dedicated player view; touch targets; no hover-only actions. Offline backend indicator must not imply streaming is unavailable if Stremio still works.

**Visual brand:** unique product name and visual assets. Netflix-like information architecture and polished presentation are desired, but do not use Netflix trademarks, logo, proprietary UI assets, sounds, or misleading official branding. Maintain source credits and third-party licenses.

## 10. Security, privacy, and family controls

- HTTPS for production APIs; certificate validation enabled; safe localhost HTTP only in development. No embedded shared secrets. Encrypt local sensitive session data with Android Keystore/Windows OS facilities where feasible; encrypt server-held protected tokens at rest and provision keys outside the repo.
- Stremio credentials remain in isolated vendor sessions. Never forward third-party auth cookies or stream URLs to a recommender, log aggregator, analytics platform, or Household API. Do not trust client-supplied profile identity; server checks authorization on every request.
- Restrict WebView bridges to trusted origins and methods. Disable universal file access, dangerous JS interfaces, mixed-content exceptions, and arbitrary external redirects unless required and justified; validate navigation targets. Prevent XSS in metadata and curated descriptions; do not inject unsanitized strings as HTML.
- Device pairing is single use, short-lived, scoped and rate-limited. Store hashed refresh tokens/session identifiers and support revocation. Bootstrap and admin recovery cannot bypass ownership checks.
- Admin-only settings manage sources, accounts, content policy, device removal, import/export and delete. Use a salted memory-hard password/PIN hash. Apply lockouts/rate limiting. Kids profiles require family-safe defaults; hide unrated/adult metadata and untrusted lists, and do not let their accounts reach unrestricted admin/addon settings without authentication.
- Provide household/profile export in structured JSON, selective Netflix import removal, deletion with purge schedule, encrypted backups, restore tests, and a privacy statement. Historical viewing data is sensitive: no remote analytics by default. Crash diagnostics require explicit opt-in and redact titles/IDs/tokens when possible.
- Follow TMDB attribution/terms, Netflix-export policies, Stremio/addon terms, applicable rights for catalog text/images, upstream MIT notices, and lawful stream sources. This app is a client; it does not provide unlicensed media.

## 11. Resilience, quality and performance

**Targets (engineering objectives, not claims about existing DX.BI):** warm Home available from cache in <=2 seconds on reference Shield in normal conditions; navigation input-to-visible-focus <=100 ms at p95 on representative rails; no main-thread blocking network calls; client cold start to useful UI target <=5 seconds after profile session restoration, excluding mandatory login, first-run metadata fetch, and unusually slow network; input remains responsive during image loads. Collect local benchmark evidence and report observed values rather than hiding missed targets.

Use image lazy-loading, poster size negotiation, bounded memory/disk caches, background prefetch for next visible items, cancellable requests, provider timeouts, rate-limit awareness, and a last-known-good home snapshot. All queues are retryable and idempotent; do not lose events on process death, crashes, or intermittent network. Bound retry queues, avoid exposing full browsing history in telemetry, and never let recommendation jobs affect playback priority. On a failed metadata provider request, show a localized retry state or alternate permitted metadata provider rather than crashing.

## 12. Required test strategy and acceptance gates

**Automated tests:** unit tests for profile isolation, ID resolution, Netflix parsing/idempotency, recency/feedback ranking, kid filters, playback conflict resolution, cache scoping, source fallback, role authorization, input handling, and stream-selection policy. API contract tests include unauthorized cross-profile access, token expiry/revocation, malformed imports, resource versions, and pagination. Component integration tests mock Stremio/addon APIs and verify source errors don't blank Home. Ensure no real account credentials or real household history appear in test fixtures.

**Android tests:** compile Debug APK, instrument UI and WebView isolation tests with two synthetic Stremio test accounts when credentials can be securely provided. Test a real Shield for DPAD interactions, play/pause/seek/Back, app background/resume, account switching, WebView feature availability, HDR/audio/subtitles as compatible with the device and test stream; test Google TV emulator and a physical or emulated Android phone. Where hardware or credentials are unavailable, run emulator/synthetic coverage and mark the hardware gate **unverified**, not passed.

**Windows tests:** package an x64 installer/portable build, confirm multiple Electron session partitions, switch profiles without leakage, verify player/stream server, verify install/uninstall and recovery after restart.

**End-to-end acceptance scenarios (all release blocking unless explicitly capability-gated):**

1. Admin creates two adult profiles, links two different Stremio accounts, restarts app; each profile returns to its own authenticated Stremio session without showing the other's watchlist or addon setup.
2. Profile A plays a movie, stops partway; Continue Watching shows correct title/position for A only. B's profile remains unaffected; switching does not retain A's stream links.
3. A resumes on Windows after Shield playback and sees the most recent authoritative position; an older queued heartbeat never rewinds it.
4. Import one Netflix CSV to B; B receives watched-history signals and relevant recommendations; A's recommendations are unchanged. Reimport same file does not duplicate events.
5. Ambiguous Netflix title requires review; incorrect mapping can be reversed; episodic imports don't imply completed seasons.
6. A likes or hides a title; candidate ranking/visibility changes and a truthful reason is displayed. Profile B is unaffected.
7. Community list displays attribution; Original Order matches source; Ranked for Me remains within list; inaccessible provider doesn't break Home.
8. A kids profile cannot access adult/unrated content, adult recommendations, unrestricted settings, or sensitive imports via UI or backend APIs.
9. Disconnect Household backend: cached Home and working Stremio playback remain usable; sync resumes cleanly when backend returns.
10. Disconnect metadata provider: UI degrades, shows meaningful feedback, and does not hang or leak raw errors.
11. Every TV interaction—including profile selection, sign-in handoff, Home rails, search, details, source picker and player exit—is operable using Shield remote alone.
12. App ships Android TV APK, mobile Android APK or deliberately unified adaptive APK validated on both device classes, Windows build, Docker Compose backend, migrations, test reports, and deployment/recovery documentation.

## 13. Deliverable contract for the coding agent

Deliver source code, lockfiles, reproducible build scripts, `.env.example`, documented secrets provisioning, database migrations, synthetic demo fixtures, automated tests, CI for lint/typecheck/tests/builds, Android debug APK, Windows installer/portable artifact, backend container images/Compose, release instructions, and a concise operations guide. Keep the upstream license and credits, enumerate third-party dependencies/licenses, document Stremio API assumptions with tests, and provide a clear list of unmet acceptance gates supported by evidence. Do not falsely report tests run on hardware that was not accessible.

Before invasive changes, inspect current upstream repository and commit hash, build the unmodified TV and Windows targets, and create compatibility regression baselines. Preserve upstream functionality by default; annotate deviations. Produce architecture decision records for WebView account isolation, Stremio syncing, backend security, recommendation provider, and mobile UI strategy. Agents may independently decide implementation details within this spec. Use conservative secure defaults; work without asking the owner technical questions. Only human-controlled credentials, account approval, private infrastructure access, or subjective design sign-off may require owner action; all other work belongs to the engineer/agent.

**Definition of done:** a person unfamiliar with Stremio can choose their profile on a NVIDIA Shield, browse personal and community recommendations, play or resume a legitimately available stream, see their own isolated progress, and carry that profile to Windows or Android without data leakage; Netflix CSV imports and recommendation updates work; documented builds and tests substantiate the behavior. A polished mockup, a recommendations addon installed in only one shared Stremio account, or a profile picker with shared auth does **not** satisfy this specification.

## 14. Source and compatibility references

- DX.BI repository: `https://github.com/notdxbi/dxbi-stremio` — Android TV architecture, Electron app, root plugin, MIT license; inspect actual pinned commit.
- DX.BI TV build docs: `https://raw.githubusercontent.com/notdxbi/dxbi-stremio/main/tv/README.md`.
- Watchly: `https://github.com/TimilsinaBimal/Watchly` — MIT recommendation addon, history sources, catalog implementation.
- My Lists: `https://github.com/Br0ck25/My-Lists` — curated catalogs/community lists; source and deployment constraints.
- Stremio addon SDK/protocol: `https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md`.
- Android WebView profiles: `https://developer.android.com/reference/androidx/webkit/WebViewCompat` — check `WebViewFeature.MULTI_PROFILE` at runtime, call `setProfile` before navigating.
- Netflix Viewing Activity help: `https://help.netflix.com/en/node/101917` — official per-profile CSV export.
- TMDB attribution/licensing: `https://developer.themoviedb.org/docs/faq` and `https://www.themoviedb.org/api-terms-of-use` — check current terms prior to implementation and release.

*Verified baseline: DX.BI's published TV app is a WebView-based Stremio client with native Media3 playback, and its Windows client uses Electron. The backend, separated Stremio sessions, mobile app, and Netflix-aware recommendation workflow specified here are **requirements to build**, not features verified in upstream DX.BI.*
