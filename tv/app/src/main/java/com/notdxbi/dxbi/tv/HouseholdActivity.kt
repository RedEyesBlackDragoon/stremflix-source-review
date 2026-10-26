package com.notdxbi.dxbi.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.ProfileStore
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.io.IOException
import java.security.MessageDigest

/** Origin-scoped Household bridge; Stremio never receives this interface or Household tokens. */
class HouseholdActivity : AppCompatActivity() {
    private var web: WebView? = null
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var vault: SecureStore
    private lateinit var server: String
    private lateinit var localStore: LocalProfileStore
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker=registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri=result.data?.data?.takeIf { it.scheme=="content" }
        fileCallback?.onReceiveValue(if(result.resultCode==RESULT_OK && uri!=null) arrayOf(uri) else null)
        fileCallback=null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vault = SecureStore(this)
        localStore = LocalProfileStore(this)
        ProfileCleanup.drain(this)
        server = getSharedPreferences("household", MODE_PRIVATE).getString("server", "") ?: ""
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { web?.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'BrowserBack',bubbles:true}))", null) }
        })
        loadLocal()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun loadLocal() {
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            connectScreen("Update Android System WebView to use secure local profiles.");return
        }
        web?.destroy()
        val view=WebView(this)
        if(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE))WebViewCompat.setProfile(view,"household-shell")
        web=view
        view.settings.apply {javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW}
        val loader=WebViewAssetLoader.Builder().addPathHandler("/assets/",WebViewAssetLoader.AssetsPathHandler(this)).build()
        WebViewCompat.addWebMessageListener(view,"LocalBridge",setOf(LOCAL_ORIGIN)){_,message,origin,mainFrame,reply->
            if(!mainFrame || origin.toString().trimEnd('/')!=LOCAL_ORIGIN)return@addWebMessageListener
            val raw=message.data ?: return@addWebMessageListener
            if(raw.length>4096)return@addWebMessageListener
            executor.execute {
                val result=JSONObject();var requestId=""
                try {
                    val body=JSONObject(raw);requestId=body.getString("id");val value=body.optJSONObject("value") ?: JSONObject()
                    val answer:Any=when(val method=body.getString("method")){
                        "state" -> localStore.publicState(if((getSystemService(UI_MODE_SERVICE) as android.app.UiModeManager).currentModeType==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)"android-tv" else "android-mobile")
                        "create" -> localStore.create(value.getString("name"),value.getString("avatar"))
                        "open" -> {
                            val profile=localStore.profile(value.getString("id"))
                            require(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)){"Update System WebView to open isolated accounts"}
                            runOnUiThread {startActivity(Intent(this,MainActivity::class.java).putExtra("profileUuid",profile.getString("id")).putExtra("localProfile",true))};true
                        }
                        "delete","reset" -> {
                            val id=localStore.profile(value.getString("id")).getString("id")
                            val latch=java.util.concurrent.CountDownLatch(1);var failure:Exception?=null
                            runOnUiThread {try{ProfileCleanup.remove(this,id)}catch(e:Exception){failure=e}finally{latch.countDown()}}
                            require(latch.await(5,TimeUnit.SECONDS)){"Close playback before removing this profile"};failure?.let {throw it}
                            vault.removePrefix("plugin-settings-$id-")
                            if(method=="delete")localStore.remove(id) else localStore.reset(id)
                            true
                        }
                        "server" -> {runOnUiThread{connectScreen()};true}
                        "licenses" -> {val notice=assets.open("licenses.txt").bufferedReader().use{it.readText()};runOnUiThread{androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Licenses and credits").setMessage(notice).setPositiveButton("Close",null).show()};true}
                        else -> throw IllegalArgumentException("Unknown local profile action")
                    }
                    result.put("value",answer)
                }catch(e:Exception){result.put("error",e.message?.take(200) ?: "This local action could not be completed")}
                result.put("id",requestId);runOnUiThread{reply.postMessage(result.toString())}
            }
        }
        val script=assets.open("local-native.js").bufferedReader().use{it.readText()}
        WebViewCompat.addDocumentStartJavaScript(view,script,setOf(LOCAL_ORIGIN))
        view.webViewClient=object:WebViewClient(){
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=request.url.host!="appassets.androidplatform.net" || request.url.scheme!="https"
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):android.webkit.WebResourceResponse? {
                if(request.url.host!="appassets.androidplatform.net")return android.webkit.WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),java.io.ByteArrayInputStream(byteArrayOf()))
                return loader.shouldInterceptRequest(request.url)
            }
        }
        setContentView(view);view.requestFocus();view.loadUrl("$LOCAL_ORIGIN/assets/local/index.html")
    }

    private fun connectScreen(message: String = "") {
        web?.destroy(); web = null
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48,48,48,48); setBackgroundColor(0xff101318.toInt()) }
        fun label(value: String, size: Float) = TextView(this).apply { text=value; textSize=size; setTextColor(0xfff5f6f7.toInt()); setPadding(0,8,0,16) }
        layout.addView(label("STREMFLIX Household Edition",30f))
        layout.addView(label("Connect your private Household server. Each viewer keeps a separate Stremio account.",20f))
        val address = EditText(this).apply {
            hint="https://household.example.com"; setText(server); setTextColor(0xfff5f6f7.toInt())
            inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true); contentDescription="Household server HTTPS address"
        }
        layout.addView(address)
        layout.addView(Button(this).apply {
            text="Connect"
            setOnClickListener {
                val input=address.text.toString().trim().trimEnd('/')
                val uri=Uri.parse(input)
                val debug=applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
                val local=uri.host in setOf("127.0.0.1","localhost","10.0.2.2")
                if ((uri.scheme!="https" && !(debug && local && uri.scheme=="http")) || uri.host.isNullOrEmpty() ||
                    uri.userInfo!=null || !uri.path.isNullOrEmpty() || uri.query!=null || uri.fragment!=null) {
                    connectScreen("Use an HTTPS origin. Debug builds also allow emulator localhost.")
                } else {
                    if(server!=input) vault.put("session",null)
                    server=input
                    getSharedPreferences("household",MODE_PRIVATE).edit().putString("server",server).apply()
                    loadHousehold()
                }
            }
        })
        layout.addView(label(message,18f)); setContentView(layout); address.requestFocus()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun loadHousehold() {
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            connectScreen("Update Android System WebView to use the secure Household bridge."); return
        }
        val view=WebView(this)
        if(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) WebViewCompat.setProfile(view,"household-shell")
        web=view
        view.webChromeClient=object : WebChromeClient() {
            override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null);fileCallback=callback
                filePicker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/*"))
                return true
            }
        }
        view.settings.apply {
            javaScriptEnabled=true; domStorageEnabled=true; allowFileAccess=false; allowContentAccess=false
            mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW; mediaPlaybackRequiresUserGesture=true
        }
        WebViewCompat.addWebMessageListener(view,"HouseholdBridge",setOf(server)) { _, message, origin, mainFrame, reply ->
            if(!mainFrame || origin.toString().trimEnd('/')!=server) return@addWebMessageListener
            val raw=message.data ?: return@addWebMessageListener
            if(raw.length>8192) return@addWebMessageListener
            executor.execute {
                var requestId=""
                val result=JSONObject()
                try {
                    val body=JSONObject(raw); requestId=body.getString("id")
                    val value=body.opt("value")
                    val returned: Any=when(body.getString("method")) {
                        "rememberSession" -> {
                            if(value==null || value==JSONObject.NULL) vault.put("session",null)
                            else {
                                val session=value as? JSONObject ?: throw IllegalArgumentException()
                                require(session.getString("access_token").length<=200 && session.getString("refresh_token").length<=200)
                                vault.put("session",session.toString())
                            }; true
                        }
                        "restoreSession" -> vault.get("session")?.let { JSONObject(it) } ?: JSONObject.NULL
                        "openProfile" -> { openProfile(value as? JSONObject ?: throw IllegalArgumentException()); true }
                        else -> throw IllegalArgumentException()
                    }
                    result.put("value",returned)
                } catch (_: Exception) { result.put("error","Profile unavailable. Reconnect Household or update WebView. Kids playback is locked pending policy verification.") }
                result.put("id",requestId); runOnUiThread { reply.postMessage(result.toString()) }
            }
        }
        val script=assets.open("household-native.js").bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(view,script,setOf(server))
        view.webViewClient=object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = "${request.url.scheme}://${request.url.encodedAuthority}"!=server
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if(request.isForMainFrame) connectScreen("Household server is unreachable. Check its address and connection.")
            }
        }
        setContentView(view); view.loadUrl(server)
    }

    private fun openProfile(value: JSONObject) {
        val id=UUID.fromString(value.getString("profileId")).toString()
        require(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE))
        val token=value.getString("token"); require(token.length<=200)
        val client=OkHttpClient.Builder().callTimeout(8,TimeUnit.SECONDS).followRedirects(false).build()
        val tokenHash=MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
        try {
        client.newCall(Request.Builder().url("$server/v1/profiles").header("Authorization","Bearer $token").build()).execute().use { response ->
            if(response.code>=500)throw IOException("Household unavailable")
            require(response.isSuccessful)
            val profiles=JSONArray(response.body?.string() ?: "[]")
            val selected=(0 until profiles.length()).map { profiles.getJSONObject(it) }.first { it.getString("id")==id }
            require(!selected.getBoolean("kid"))
        }
        val request=Request.Builder().url("$server/v1/profiles/$id/activate").header("Authorization","Bearer $token")
            .post("{\"pin\":\"\"}".toRequestBody("application/json".toMediaType())).build()
        client.newCall(request).execute().use { response ->
            require(response.isSuccessful)
            val credentials=JSONObject(response.body?.string() ?: "{}")
            vault.put("sync-config-$id",JSONObject().put("server",server).put("credentials",credentials).toString())
        }
        vault.put("profile-grant-$id",JSONObject().put("server",server).put("profileId",id).put("tokenHash",tokenHash)
            .put("kid",false).put("expiresAt",System.currentTimeMillis()+86400000).toString())
        } catch (_: IOException) {
            // Network outages permit only the same previously authorized adult profile and server.
            val grant=JSONObject(vault.get("profile-grant-$id") ?: throw IllegalStateException("Reconnect Household"))
            require(grant.getString("server")==server && grant.getString("profileId")==id && grant.getString("tokenHash")==tokenHash &&
                !grant.getBoolean("kid") && grant.getLong("expiresAt")>System.currentTimeMillis() && vault.get("sync-config-$id")!=null)
        }
        val external=value.optString("externalId").takeIf { Regex("tt\\d{4,12}").matches(it) }
        val kind=value.optString("type").takeIf { it=="movie" || it=="series" }
        val route=if(external!=null && kind!=null) "#/detail/$kind/$external" else ""
        runOnUiThread { startActivity(Intent(this,MainActivity::class.java).putExtra("profileUuid",id).putExtra("route",route)) }
    }
    override fun onDestroy() { web?.destroy(); executor.shutdownNow(); super.onDestroy() }
    override fun onResume(){super.onResume();web?.evaluateJavascript("window.dispatchEvent(new Event('focus'))",null)}
    companion object {const val LOCAL_ORIGIN="https://appassets.androidplatform.net"}
}
