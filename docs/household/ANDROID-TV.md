# Local Android TV build

Tonight's target is the standalone Android TV app, version `0.1.9-local-tv`.
The APK uses application ID `org.dxbi.household.android` and appears as **DXBI Household TV**.
It is debug signed. Keep the same signing key for subsequent updates that retain device data.

## Install and use

Install `artifacts/household-tv-local/dxbi-household-tv-local-0.1.9.apk` on the TV using an APK installer or ADB:

```powershell
adb install -r artifacts/household-tv-local/dxbi-household-tv-local-0.1.9.apk
```

Open STREMFLIX Household from the TV launcher. Choose **Add Profile** to create a viewer. No PIN is required.
Choose the viewer with the remote and sign in through Stremio's own interface.
Each viewer needs a different Stremio account. Add further viewers in Manage Profiles.
Stremio retains its own library, add-ons and watch progress inside each isolated account session.
Media opens in the preserved native Media3 player. Back returns to browsing; from the top-level
browse screen, press Back twice when prompted to return to profiles.
The persistent **Switch Profile** button above Stremio returns directly to the viewer picker.
Use the remote Menu button to focus it, then OK, or navigate to it/click it directly.
Switching leaves the Stremio account signed in within its own isolated viewer session.

Fast TV browsing is enabled by default: no rotating billboard, hover previews, auto trailers,
interface sounds, backdrop blur, or queued smooth scrolling. It can be disabled in DXBI settings.
On a catalog row, **Up/Down** moves directly between rows. **Right** after the last poster reaches See All.
Press **OK** to open the full Discover catalog and navigate its grid with the remote.
Library navigation follows the visible sort order, excludes hidden titles, and preserves the
grid column. Holding Up stops at the first grid row; release and press Up again to enter filters.
Left/Right traverses each filter row, including Last Watched and the native sort chips.
Up/Down moves between the two filter rows; Up from the first row reaches the sidebar.
The header follows its visible layout: Left/Right across top tabs, Down into filters;
a vertical sidebar uses Up/Down and Right. The active tab keeps its underline;
the focused tab label turns white immediately, without a rectangle.
Down from the bottom filter row returns to the same grid column. Repeat navigation is limited to a rendered
frame; excess repeated events are discarded rather than queued. Background metadata sorting
is deferred while the Library grid has focus, so titles do not reorder underneath navigation.

The local profile picker and viewer setup are bundled in the APK. No Household server, Docker,
Python, or synchronization service is required. Stremio browsing, sign-in and streaming still
require network access and playable sources supplied through the user's account.
Update Android System WebView through the Play Store if the app reports that isolated accounts
are unavailable. It refuses to share a session when the required multi-profile API is absent.

Manage Profiles can delete a local profile or clear its sign-in for reconnection.
Reconnection assigns a fresh session immediately. WebView can retain the removed session's
files until the next app process start, when queued deletion runs before any viewer is loaded.
Android Keystore protects the local account bindings. Profile management is open on this device;
there are no PIN gates or parental controls. Android app-data clearing removes local setup.

## Build

With JDK 17/21 and Android SDK 35 configured in `tv/local.properties` or `ANDROID_HOME`:

```powershell
pwsh -File tools/household/Build-TV.ps1
```

Add `-TestDevice` to run the Android instrumentation suite on connected emulators/devices.
This build path has no backend or Windows dependency. Gradle's wrapper and pinned dependencies
define the build inputs; the debug signing key belongs to the build machine. SHA256SUMS.txt
identifies the resulting artifact; byte-identical outputs across different signing keys are not claimed.

The opt-in anonymous live compatibility check is separate:

```powershell
cd tv
./gradlew.bat connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.notdxbi.dxbi.tv.LocalTvLiveTest' '-Pandroid.testInstrumentationRunnerArguments.liveStremio=true'
```

It only runs on a clean TV test installation and never enters account credentials.

## Scope and remaining validation

The local build does not include the custom Netflix importer, Netflix-aware recommendation engine,
Household community discovery, kids filtering, or cross-device sync in its local interface.
Existing backend implementations remain available for further development through the optional server.
The original full specification remains incomplete.

TV emulator checks cover isolated cookies/storage, encrypted storage, profile migration, account-binding
conflicts, bundled setup, and synthetic H.264 native playback/pause/Back. These checks do not establish
real account behavior, NVIDIA Shield hardware compatibility, HDR, surround sound, DRM, or real source playback.
Those require an authorized account and physical hardware. See ACCEPTANCE.md for recorded evidence.
