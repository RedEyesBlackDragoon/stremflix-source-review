# STREMFLIX Household Edition

Development implementation based on DX.BI commit `ac8469def67ccc5dcabbea123d023fcb5e380429`.
The authoritative product specification is [SPEC.md](docs/household/SPEC.md).
This build is **not release ready**. See [ACCEPTANCE.md](docs/household/ACCEPTANCE.md) for the remaining gates.

## Run the software

**For tonight's single-device Android TV use, start with [the standalone local TV build](docs/household/ANDROID-TV.md).**
It requires no Household backend. Build it with `pwsh -File tools/household/Build-TV.ps1`.
The server instructions below apply to the optional extended Household experience.

On Windows, start the development API and worker from the repository root:

```powershell
pwsh -File tools/household/Start-Local.ps1 -Open
```

The service listens on `http://127.0.0.1:8765`. The script generates a private enrollment token,
applies migrations, and starts both processes. The browser opens the enrollment flow when `-Open` is present.
Set an administrator password in the application. Create profiles through **Add Profile**.
Use **Manage [name]** for imports, preferences, catalogs, and pairing. Selecting a profile for viewing drops administrator authority.

Connect the Windows app to this address. For an Android emulator, use `http://10.0.2.2:8765` in a debug APK.
Physical Android devices require a reachable HTTPS service. The API accepts localhost HTTP only for development.
The initial setup requires an internet connection to download dependencies.

Metadata catalogs require an operator allowlist. The local script allows the official Cinemeta host.
In Admin Settings, add `https://v3-cinemeta.strem.io/manifest.json` with the source name **Cinemeta**.
The worker fetches permitted movie and series catalogs. Catalogs provide discovery metadata, not playable media.

Each adult profile opens its own Stremio session. Sign in through Stremio's own interface.
No Stremio password enters the Household backend. Backend account bindings record the stable ID reported by the authenticated client runtime.
Real account verification remains a release gate. Kids can browse filtered Household metadata; unrestricted Stremio playback is locked for kids.

## Build and test

Prerequisites: Node.js 22 or newer, Python 3.12, JDK 17 or 21, Android SDK platform 35, and Android build tools.
Set `ANDROID_HOME` or `tv/local.properties` to the SDK location. No upstream signing key is used.

```powershell
pwsh -File tools/household/Build.ps1
```

Outputs go to `artifacts/household-dev/` with SHA-256 hashes. Android uses `org.dxbi.household.android`.
Windows uses `org.dxbi.household.desktop` and separate application data. Windows artifacts are unsigned development builds.
The unified Android APK contains an adaptive Household interface and the preserved native Media3 player.
Mobile Stremio surfaces still need further validation; a successful APK build does not establish full phone compatibility.

Run Android instrumentation separately with `tv/gradlew.bat connectedDebugAndroidTest` when an emulator is connected.
Run `docker compose --env-file household/.env -f household/compose.yaml up --build` for the container deployment after provisioning its environment.
See [OPERATIONS.md](docs/household/OPERATIONS.md) for production setup and recovery.

The upstream [README.md](README.md) describes the original app. Its shared-session import and upstream update instructions do not apply to this fork.

## Source layout

| Directory | Responsibility |
| --- | --- |
| `household/service` | FastAPI authorization, data model, catalog worker, Netflix importer, ranking, and playback reconciliation |
| `household/web` | Shared TV, mobile, and desktop Household interface |
| `shared/stremio-adapter.js` | Stremio runtime boundary and sanitized playback sampling |
| `app/src/household` | Electron launcher, persistent session partitions, OS-encrypted session and event storage |
| `tv/app/src/main` | Android shell, WebView profiles, Keystore storage, and Media3 playback |
| `household/migrations` | Alembic schema migrations |
| `docs/household` | Test evidence, decisions, privacy, operations, and acceptance status |

The repository retains the upstream MIT notices and playback implementation.
The application contains no real profiles, Netflix histories, Stremio passwords, or preconfigured stream providers.
