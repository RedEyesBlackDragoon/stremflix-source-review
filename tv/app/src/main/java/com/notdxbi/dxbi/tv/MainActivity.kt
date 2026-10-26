package com.notdxbi.dxbi.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Stremflix TV: Stremio's web app with Stremflix built in, steered with the remote. Streams play in
 * [PlayerActivity]; this screen stays alive underneath so Stremio keeps the watch progress.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var injectedAtStart = false
    private var lastBack = 0L
    private var householdSync: HouseholdPlaybackSync? = null
    private var localMode=false
    private var playerOpen = false
    private var restorationPrelude = ""
    private var restorationScript: androidx.webkit.ScriptHandler? = null
    private var playbackListener: PlaybackBus.Listener? = null
    private val playerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        playerOpen = false
        if (!::web.isInitialized) return@registerForActivityResult
        val packet = result.data?.getStringExtra(PlayerActivity.EXTRA_CLOSE)
        if (packet == null) {
            if (web.url == null || web.url == "about:blank") web.loadUrl(STREMIO_URL)
            return@registerForActivityResult
        }
        if (web.url == null || web.url == "about:blank") {
            val context = org.json.JSONObject(packet).optJSONObject("context")
            val hash = context?.optString("hash")?.takeIf { it.startsWith("#/player/") } ?: ""
            restorationPrelude = "window.__dxbiTvPendingClose=$packet;try{sessionStorage.setItem('dxbi.splash','1')}catch(_){};"
            if (injectedAtStart) restorationScript = WebViewCompat.addDocumentStartJavaScript(web, restorationPrelude, setOf(STREMIO_ORIGIN))
            web.loadUrl(STREMIO_URL + hash)
        } else js("window.__dxbiTv && window.__dxbiTv.restoreNativePlayback($packet)")
    }
    @Volatile private var localIdentityVerified=false
    lateinit var profileUuid: String
        private set
    private val television: Boolean by lazy {
        (getSystemService(UI_MODE_SERVICE) as android.app.UiModeManager).currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        playerOpen = savedInstanceState?.getBoolean("nativePlayerOpen") ?: false
        profileUuid = try { java.util.UUID.fromString(intent.getStringExtra("profileUuid")).toString() }
            catch (_: Exception) { finish(); return }
        localMode=intent.getBooleanExtra("localProfile",false)
        if(localMode)try{LocalProfileStore(this).profile(profileUuid)}catch(_:Exception){finish();return}
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            AlertDialog.Builder(this).setTitle("An isolated account session is required")
                .setMessage("Update Android System WebView before linking an account. Shared authenticated sessions are disabled.")
                .setPositiveButton("Close") { _, _ -> finish() }.setOnCancelListener { finish() }.show()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        if (!webViewIsRecentEnough()) return

        // Debug builds can be inspected from a computer (chrome://inspect)
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        WebViewCompat.setProfile(web, profileUuid)
        if(!localMode)householdSync = HouseholdPlaybackSync(this, profileUuid)
        // Full screen: the profile lives in the page's own top-right menu (see dxbi-tv.js)
        setContentView(web)
        web.setBackgroundColor(getColor(R.color.background))
        web.isFocusable = true
        web.isFocusableInTouchMode = true

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            // A desktop browser's identity (Stremio's web app is made for one), plus Stremflix TV's mark
            userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/${chromeVersion()} Safari/537.36 " +
                (if (television) "dxbi-tv/" else "dxbi-mobile/") + BuildConfigVersion.name(this@MainActivity)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)

        web.addJavascriptInterface(Bridge(this), "DxbiTV")
        val adapterScript = assets.open("stremio-adapter.js").bufferedReader().use { it.readText() }
        val startScript = adapterScript + "\nwindow.__householdAdapter = new window.DXBIStremioAdapter(window);\n" +
            assets.open("dxbi-tv.js").bufferedReader().use { it.readText() } +
            "\nsetInterval(()=>window.__householdAdapter.identity().then(id=>{if(id)DxbiTV.verifyIdentity(id)}).catch(()=>{}),3000);"
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, startScript, setOf(STREMIO_ORIGIN))
            injectedAtStart = true
        }

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // Older WebViews can't run a script before the page: run it as early as possible instead
                if (!injectedAtStart && url != null && Uri.parse(url).let { it.scheme == "https" && it.host == "web.stremio.com" }) view.evaluateJavascript(restorationPrelude + startScript, null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                restorationScript?.remove()
                restorationScript = null
                restorationPrelude = ""
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "https" && url.host == "web.stremio.com" && url.port == -1) return false
                if (url.scheme == "stremio") {
                    openStremioLink(url)
                    return true
                }
                // Everything else leaves the app (sign-in pages, links in descriptions…) if something can open it
                openExternal(url.toString())
                return true
            }
        }

        playbackListener = object : PlaybackBus.Listener {
            override fun onProgress(positionMs: Long, durationMs: Long, paused: Boolean) {
                js("window.__dxbiTv && window.__dxbiTv.onProgress($positionMs, $durationMs, $paused)")
                js("window.__householdAdapter.sample({position:${positionMs / 1000.0},duration:${durationMs / 1000.0},paused:$paused}).then(s=>{if(s)DxbiTV.householdProgress(JSON.stringify(s))}).catch(()=>{})")
            }

            override fun onClosed(positionMs: Long, durationMs: Long, ended: Boolean, error: String?, then: String?) {
                // The activity result survives destruction of this browsing screen.
            }
        }
        PlaybackBus.listener = playbackListener

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })

        val route = intent.getStringExtra("route")?.takeIf { Regex("#/detail/(movie|series)/tt\\d{4,12}").matches(it) } ?: ""
        val previousUrl = savedInstanceState?.getString("browserUrl")?.takeIf {
            Uri.parse(it).let { uri -> uri.scheme == "https" && uri.host == "web.stremio.com" && uri.port == -1 }
        }
        if (!playerOpen) web.loadUrl(previousUrl ?: (STREMIO_URL + route))
        web.requestFocus()

        // Fork updates must never replace this app or plugin with an upstream release.
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.takeIf { it.scheme == "stremio" }?.let { openStremioLink(it) }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        if (::web.isInitialized) web.requestFocus()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Menu opens the profile menu (Switch Profile first), wherever you are. Remotes whose menu
        // button the system keeps (Shield's) reach it from the avatar, right of the last tab.
        if(event.keyCode==KeyEvent.KEYCODE_MENU){
            if(event.action==KeyEvent.ACTION_UP)js("window.__dxbiTv && window.__dxbiTv.profileMenu()")
            return true
        }
        // Play/pause turns a preview trailer's sound on and off. The page gets it as F10: as a media key
        // the web engine would also pause the trailer itself. Still a real key press, so it counts as
        // the user's action, which the WebView requires before sound plays.
        if (event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && ::web.isInitialized) {
            return web.dispatchKeyEvent(KeyEvent(event.downTime, event.eventTime, event.action, KeyEvent.KEYCODE_F10, event.repeatCount))
        }
        return super.dispatchKeyEvent(event)
    }

    /** The viewer on screen, for the page's avatar and menu: name and avatar colour (local profiles) */
    fun profileJson(): String = try {
        if (!localMode) "{}" else LocalProfileStore(this).profile(profileUuid).let {
            org.json.JSONObject().put("name", it.getString("name")).put("avatar", it.getString("avatar")).toString()
        }
    } catch (_: Exception) { "{}" }

    fun switchProfile() {
        startActivity(Intent(this,HouseholdActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }

    /** The page decides first (closing a card or menu, going back a screen); on Home, Back twice leaves. */
    private fun goBack() {
        if (!::web.isInitialized) { finish(); return }
        web.evaluateJavascript("(window.__dxbiTv && window.__dxbiTv.back()) ? 1 : 0") { handled ->
            if (handled == "1") return@evaluateJavascript
            val now = System.currentTimeMillis()
            if (now - lastBack < 2500) finish()
            else {
                lastBack = now
                Toast.makeText(this, "Press Back again to return to your household", Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun play(json: String) {
        val uri = try { Uri.parse(org.json.JSONObject(json).getString("url")) } catch (_: Exception) { return }
        if (uri.scheme !in setOf("http", "https")) return
        if (if(localMode)!localIdentityVerified else householdSync?.identityVerified != true) {
            Toast.makeText(this,"Reconnect the Stremio account linked to this profile before playback.",Toast.LENGTH_LONG).show()
            return
        }
        playerOpen = true
        playerLauncher.launch(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_STREAM, json).putExtra(PlayerActivity.EXTRA_PROFILE, profileUuid))
    }

    fun householdProgress(json: String) { householdSync?.record(json) }
    fun verifyIdentity(identity: String) {
        if(!localMode){householdSync?.verifyIdentity(identity);return}
        try{LocalProfileStore(this).bind(profileUuid,identity);localIdentityVerified=true}
        catch(e:Exception){
            localIdentityVerified=false
            runOnUiThread{
                js("window.__householdAdapter && window.__householdAdapter.signOut(); void 0;")
                AlertDialog.Builder(this).setTitle("Reconnect this profile").setMessage(e.message).setPositiveButton("Back to profiles"){_,_->finish()}.show()
            }
        }
    }

    fun openExternal(url: String) {
        if (Uri.parse(url).scheme !in setOf("https", "http", "market")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: Exception) {
            Toast.makeText(this, "No app on this TV can open that link", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openStremioLink(uri: Uri) {
        // stremio://host/path/manifest.json → install the addon through Stremio's Addons screen
        val manifest = uri.toString().replaceFirst("stremio://", "https://")
        web.loadUrl("$STREMIO_URL#/addons?addon=" + Uri.encode(manifest))
    }

    private fun js(code: String) {
        if (::web.isInitialized) web.post { web.evaluateJavascript(code, null) }
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun chromeVersion(): String =
        WebViewCompat.getCurrentWebViewPackage(this)?.versionName?.substringBefore(" ") ?: "120.0.0.0"

    /**
     * Stremio's web app needs a modern WebView; old TVs that never updated it get told how. Only a
     * version we can actually read counts as too old (Fire TV's own WebView names itself differently).
     */
    private fun webViewIsRecentEnough(): Boolean {
        val name = WebViewCompat.getCurrentWebViewPackage(this)?.versionName ?: return true
        val major = Regex("""^(\d+)\.""").find(name)?.groupValues?.get(1)?.toIntOrNull() ?: return true
        if (major >= MIN_WEBVIEW) return true
        val fireTv = Build.MANUFACTURER.equals("Amazon", ignoreCase = true)
        setContentView(View(this))
        val builder = AlertDialog.Builder(this)
            .setTitle(if (fireTv) "Update your Fire TV" else "Update Android System WebView")
            .setCancelable(false)
        if (fireTv) {
            builder.setMessage("Stremflix needs a newer web engine than this Fire TV has ($major). Update it under Settings → My Fire TV → About → Check for Updates, then open Stremflix again.")
                .setPositiveButton("Close") { _, _ -> finish() }
        } else {
            builder.setMessage("Stremflix needs Android System WebView $MIN_WEBVIEW or newer (this TV has $major). Update it from the Play Store (search \"Android System WebView\"), then open Stremflix again.")
                .setPositiveButton("Open Play Store") { _, _ ->
                    openExternal("market://details?id=com.google.android.webview")
                    finish()
                }
                .setNegativeButton("Close") { _, _ -> finish() }
        }
        builder.show()
        return false
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("nativePlayerOpen", playerOpen)
        if (::web.isInitialized) outState.putString("browserUrl", web.url)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        householdSync?.close()
        if (PlaybackBus.listener === playbackListener) PlaybackBus.listener = null
        restorationScript?.remove()
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    companion object {
        const val STREMIO_ORIGIN = "https://web.stremio.com"
        const val STREMIO_URL = "https://web.stremio.com/"
        const val MIN_WEBVIEW = 100
    }
}
