package com.notdxbi.dxbi.tv

import android.app.Activity
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class PlaybackRecreationTest {
    @Test fun previousEpisodeSurvivesDestructionOfTheBrowsingActivity() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val store = LocalProfileStore(context)
        val id = store.create("Synthetic playback lifecycle", "teal").getString("id")
        val identity = "synthetic-lifecycle-$id"
        store.bind(id, identity)
        val server = MockWebServer()
        val video = instrumentation.context.assets.open("synthetic-video.mp4").use { it.readBytes() }
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest) =
                MockResponse().setHeader("Content-Type", "video/mp4").setBody(Buffer().write(video))
        }
        server.start(InetAddress.getByName("127.0.0.1"), 0)
        val html = """
            <html><head></head><body><script>
            sessionStorage.setItem('dxbi.splash','1');
            const videoUrl=${JSONObject.quote(server.url("/video.mp4").toString())};
            const addon='https://fixture.invalid/manifest.json';
            const videos=[9,10].map(e=>({id:'s3e'+e,season:3,episode:e,title:'Episode '+e,
              deepLinks:{player:null,metaDetailsStreams:'#/detail/series/tt1234567/s3e'+e}}));
            window.core={dispatch:()=>{},getState:async name=>name==='player'?{
              selected:{stream:{url:videoUrl,behaviorHints:{bingeGroup:'fixture'}},
                metaRequest:{path:{id:'tt1234567',type:'series'}},
                streamRequest:{base:addon,path:{type:'series',id:location.hash==='#/player/episode9'?'s3e9':'s3e10'}}},
              stream:{type:'Ready',content:{url:videoUrl}},libraryItem:null,nextVideo:null,
              metaItem:{type:'Ready',content:{name:'Lifecycle fixture',videos}}
            }:name==='meta_details'?{selected:{streamPath:{id:'s3e9'}},streams:[
              {addon:{transportUrl:addon},content:{type:'Ready',content:[
                {behaviorHints:{bingeGroup:'fixture'},deepLinks:{player:'#/player/episode9'}}
              ]}}
            ]}:{profile:{settings:{bingeWatching:false}}}};
            window.__householdAdapter={identity:async()=>${JSONObject.quote(identity)},sample:async()=>null};
            window.__fixtureReady=true;
            </script></body></html>
        """.trimIndent()
        val firstPlayer = AtomicReference<PlayerActivity>()
        val browsers = mutableListOf<MainActivity>()
        val players = mutableListOf<PlayerActivity>()
        val firstOpened = CountDownLatch(1)
        val mainStopped = CountDownLatch(1)
        val mainRecreated = CountDownLatch(1)
        val switched = CountDownLatch(1)
        val oldEpisodeStarts = AtomicInteger()
        fun web(activity: MainActivity) = MainActivity::class.java.getDeclaredField("web").apply { isAccessible = true }.get(activity) as WebView
        val monitor = ActivityLifecycleMonitorRegistry.getInstance()
        val callback = ActivityLifecycleCallback { activity: Activity, stage: Stage ->
            if (activity is MainActivity && stage == Stage.CREATED) {
                browsers.add(activity)
                val view = web(activity)
                val previous = view.webViewClient
                view.webViewClient = object : WebViewClient() {
                    override fun onPageStarted(v: WebView, url: String?, icon: android.graphics.Bitmap?) = previous.onPageStarted(v, url, icon)
                    override fun onPageFinished(v: WebView, url: String?) = previous.onPageFinished(v, url)
                    override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest) =
                        WebResourceResponse("text/html", "UTF-8", ByteArrayInputStream(html.toByteArray()))
                }
                if (view.url != null) { view.stopLoading(); view.loadUrl(MainActivity.STREMIO_URL) }
                if (browsers.size > 1) mainRecreated.countDown()
            }
            if (activity is MainActivity && stage == Stage.STOPPED) mainStopped.countDown()
            if (activity is PlayerActivity && stage == Stage.RESUMED) {
                players.add(activity)
                val field = PlayerActivity::class.java.getDeclaredField("player").apply { isAccessible = true }
                (field.get(activity) as? ExoPlayer)?.pause()
                val current = JSONObject(activity.intent.getStringExtra(PlayerActivity.EXTRA_STREAM)!!)
                    .optJSONObject("series")?.optString("current")
                if (current == "s3e10") { oldEpisodeStarts.incrementAndGet(); firstPlayer.set(activity); firstOpened.countDown() }
                if (current == "s3e9") switched.countDown()
            }
        }
        instrumentation.runOnMainSync { monitor.addLifecycleCallback(callback) }
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            scenario = ActivityScenario.launch(Intent(context, MainActivity::class.java).putExtra("profileUuid", id).putExtra("localProfile", true))
            val deadline = SystemClock.uptimeMillis() + 10000
            var ready = false
            while (!ready && SystemClock.uptimeMillis() < deadline) {
                val checked = CountDownLatch(1)
                scenario.onActivity { a -> web(a).evaluateJavascript("window.__fixtureReady===true") { ready = it == "true"; checked.countDown() } }
                checked.await(1, TimeUnit.SECONDS)
                SystemClock.sleep(50)
            }
            assertTrue("Fixture must load before opening playback", ready)
            scenario.onActivity { a -> a.verifyIdentity(identity); web(a).evaluateJavascript("location.hash='/player/episode10'", null) }
            assertTrue("Episode 10 must open natively", firstOpened.await(10, TimeUnit.SECONDS))
            assertTrue(mainStopped.await(5, TimeUnit.SECONDS))
            instrumentation.runOnMainSync { browsers.first().recreate() }
            assertTrue("Browsing activity must be recreated behind the player", mainRecreated.await(10, TimeUnit.SECONDS))
            assertTrue("The original browsing screen must actually be destroyed", browsers.first().isDestroyed)
            instrumentation.runOnMainSync {
                fun find(v: View, predicate: (View) -> Boolean): View? {
                    if (predicate(v)) return v
                    if (v is ViewGroup) for (i in 0 until v.childCount) find(v.getChildAt(i), predicate)?.let { return it }
                    return null
                }
                val root = firstPlayer.get().window.decorView
                val episodes = find(root) { it.contentDescription?.toString() == "Episodes" }
                assertNotNull("Episodes must be available", episodes)
                episodes!!.performClick()
                var chosen = find(root) { it is TextView && it.text.toString().startsWith("9. Episode 9") }
                assertNotNull("Previous episode must remain selectable", chosen)
                while (chosen != null && !chosen.hasOnClickListeners()) chosen = chosen.parent as? View
                chosen!!.performClick()
            }
            assertTrue("Episode 9 must open after browsing-screen destruction instead of returning Home", switched.await(20, TimeUnit.SECONDS))
            assertEquals("Restoration must not reopen episode 10", 1, oldEpisodeStarts.get())
        } finally {
            instrumentation.runOnMainSync { monitor.removeLifecycleCallback(callback); players.forEach { if (!it.isDestroyed) it.finish() } }
            scenario?.close()
            instrumentation.runOnMainSync { browsers.forEach { if (!it.isDestroyed) it.finish() } }
            instrumentation.waitForIdleSync()
            store.remove(id)
            instrumentation.runOnMainSync { ProfileCleanup.remove(context, id) }
            server.shutdown()
        }
    }
}
