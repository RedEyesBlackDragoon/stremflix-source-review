# Household architecture decisions

## Account isolation

Android assigns `WebViewCompat.setProfile` before any navigation or injected JavaScript.
An unsupported WebView cannot open an authenticated vendor session. The Household shell has a different profile from every Stremio session.
The Google TV and Android phone emulator tests verify separate cookies and local storage using synthetic data.
Actual Shield WebView support and real account restoration are unverified.

Electron creates `persist:household-<profile UUID>` partitions. Profile changes destroy the previous vendor window and terminate the external player.
Plugin settings and themes also use profile-specific directories. The Household shell has a separate sandboxed session.
The fork does not import Enhanced browser state. Windows DPAPI protects saved Household credentials and the event outbox through Electron `safeStorage`.
Electron protects Chromium cookies through its platform facilities; this does not establish encryption of all IndexedDB or local-storage vendor data.

## Stremio integration and synchronization

The adapter uses `core.getState` and `core.dispatch`, as upstream already does.
The compatibility reference is Stremio Web commit `7030b128af43afddd05d906025ecd6d99743f554`.
Its `Ctx`, `Player`, `Library`, and `InstalledAddons` type declarations informed the adapter.
`identity()` returns only `ctx.profile.auth.user._id` after checking that the runtime has an authentication key.
`sample()` returns an IMDb ID, optional season and episode, duration, position, and playing state.
It never returns account keys, cookies, stream URLs, subtitle URLs, or proxy headers to Household.

Bindings are client-runtime attestations authorized by a Household session, not a server-side Stremio identity-provider assertion.
The server rejects duplicate account IDs and account changes without administrator unbinding.
The client-runtime trust model still needs validation with two synthetic Stremio accounts before release.
Stream resolution, addon configuration, library writes, and native Stremio progress remain in the vendor session.

Household events have client-generated UUIDs. The server serializes playback updates per profile on PostgreSQL,
uses deterministic timestamp and event-ID ordering, preserves completed progress against stale updates,
and exposes version-checked conflict resolution. Imported Netflix events never create playback positions.
Native Stremio-versus-Household progress reconciliation and all cross-device resume paths remain incomplete.

## Backend security

The deployment has one administrator-owned household. Enrollment requires a generated token and is disabled after ownership is established.
Argon2id hashes administrator passwords and optional PINs. Opaque access and refresh tokens are stored as SHA-256 hashes.
Refresh rotates both tokens. Revocation checks the session and device on every request.
Paired viewers have one authorized profile. Administrators can manage profiles across their household.

Every profile query resolves household membership and profile authorization. Kids cannot manage imports, devices, sources, or exports.
Kids' discovery excludes unrated works and works above the policy age. Kids cannot open unrestricted Stremio surfaces.
Provider URLs require an operator allowlist, HTTPS, a credential-free manifest path, and a public IP.
The HTTP connection pins the resolved IP and retains the provider's TLS SNI. Redirects require another allowlisted public HTTPS host and have a three-hop limit. Oversized responses are rejected.

Production uses PostgreSQL, FastAPI, a database job worker, and Caddy TLS. Redis is unnecessary for this implementation.
SQLite is a development and test convenience. Compose exposes only the TLS proxy and keeps PostgreSQL off host ports.

## Recommendation provider

The ranker is a deterministic rules engine. Its weights are documented in `household/service/ranking.py`.
Explicit preferences are stronger than imported viewing. Recent similarity and accumulated taste use separate features.
The ranker excludes hidden/disliked titles and watched movies, filters kids before scoring, and limits consecutive genre repetition.
Reasons come from actual input features. Cache keys include profile ID, policy, locale, algorithm, preferences, sources, and revisions.
These are product defaults, not scientifically optimized weights or an ML model.

Watchly was reviewed at `a3f3ca00e277ebc7bbbbdadc64bf3bc595508401`.
Its evidence weighting, long-term taste accumulation, and cache boundaries informed the design. No Watchly source code was copied.
There is no mandatory Watchly host or LLM integration. No private viewing history is sent to an LLM.

## Mobile presentation

The Household interface uses device-width layout, mobile bottom navigation, touch targets, and a separate TV directional-focus implementation.
Android's vendor viewport is device-width on phones instead of the upstream fixed 1280-pixel TV viewport.
The native Media3 activity remains the playback surface.
This provides a shared presentation foundation, but the complete mobile sign-in, details, episode, and player journeys still need validation.

## Upstream deviations

The fork uses new application IDs, branding, and storage directories. It disables upstream app/plugin replacement and shared-auth import.
Electron web security is enabled and remote-page Node integration is disabled. Playback regressions from this hardening require verification.
External players accept only HTTP(S) stream URLs and known installed executables; arbitrary executable paths are disabled.
Android disables file/content access, mixed content in the vendor WebView, and third-party cookies.
Cleartext native LAN streaming remains supported by the upstream network configuration; production Household endpoints must use HTTPS.
