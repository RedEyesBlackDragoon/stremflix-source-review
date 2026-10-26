package com.notdxbi.dxbi.tv

import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in fixture benchmark. Never reads or changes viewer accounts or media state. */
@RunWith(AndroidJUnit4::class)
class TvNavigationBenchmarkTest {
    @Test fun catalogArrivalKeepsNavigationWorkLocalToTheChangedRow() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("navigationBenchmark") == "true")
        val fixture = instrumentation.context.assets.open("navigation-fixture.html").bufferedReader().use { it.readText() }
        val scenario = ActivityScenario.launch(HouseholdActivity::class.java)
        lateinit var web: WebView
        fun js(code: String): String {
            val latch = CountDownLatch(1)
            var result = ""
            instrumentation.runOnMainSync { web.evaluateJavascript(code) { result = it; latch.countDown() } }
            assertTrue("JavaScript reply timed out", latch.await(10, TimeUnit.SECONDS))
            return result
        }
        try {
            scenario.onActivity { activity ->
                web = WebView(activity)
                web.settings.javaScriptEnabled = true
                web.settings.domStorageEnabled = true
                web.settings.userAgentString += " dxbi-tv/benchmark"
                activity.setContentView(web)
                web.requestFocus()
            }
            for (run in 0 until 5) for (variant in listOf("baseline", "candidate")) {
                val loaded = CountDownLatch(1)
                instrumentation.runOnMainSync {
                    web.webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) { loaded.countDown() }
                        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse {
                            val stream = if (request.url.toString() == "https://fixture.invalid/plugin.js") {
                                if (variant == "baseline") instrumentation.context.assets.open("baseline.plugin.js")
                                else instrumentation.targetContext.assets.open("dxbi.plugin.js")
                            } else ByteArrayInputStream(ByteArray(0))
                            return WebResourceResponse("application/javascript", "UTF-8", stream)
                        }
                    }
                    web.loadDataWithBaseURL("https://fixture.invalid/", fixture, "text/html", "UTF-8", null)
                }
                assertTrue("Fixture document must finish loading", loaded.await(15, TimeUnit.SECONDS))
                val readyDeadline = SystemClock.uptimeMillis() + 15000
                while (js("Boolean(window.fixtureReady)") != "true" && SystemClock.uptimeMillis() < readyDeadline) Thread.sleep(50)
                assertEquals("Fixture must load", "true", js("Boolean(window.fixtureReady)"))
                Thread.sleep(300)
                js("window.benchmarkResult=null;window.benchmarkError=null;runNavigationSample().then(r=>window.benchmarkResult=r).catch(e=>window.benchmarkError=e.message);void 0")
                val deadline = SystemClock.uptimeMillis() + 15000
                while (js("Boolean(window.benchmarkResult||window.benchmarkError)") != "true" && SystemClock.uptimeMillis() < deadline) Thread.sleep(100)
                assertEquals("Focus must remain correct", "null", js("window.benchmarkError"))
                val raw = js("JSON.stringify(window.benchmarkResult)")
                assertNotEquals("Benchmark must complete", "null", raw)
                val result = JSONObject(org.json.JSONTokener(raw).nextValue() as String)
                val samples = result.getJSONArray("samples")
                val times = (0 until samples.length()).map { samples.getJSONObject(it).getDouble("ms") }.sorted()
                val warmChecks = (1 until samples.length()).map { samples.getJSONObject(it).getInt("visibility") }
                assertEquals(30, result.getInt("acceptedMoves"))
                assertEquals(830, result.getInt("cards"))
                assertEquals(4, result.getInt("catalogChangeChecks"))
                if (variant == "candidate") assertTrue("An unrelated poster must not rescan the whole catalog", warmChecks.max() < 150)
                val summary = JSONObject().put("variant", variant).put("run", run)
                    .put("acceptedMoves", 30).put("failures", 0).put("medianHandlerMs", times[15])
                    .put("warmMaxVisibilityChecks", warmChecks.max()).put("catalogChangeChecks", 4)
                instrumentation.sendStatus(0, Bundle().apply { putString("stream", "[navigation-benchmark] $summary\n") })
            }
            js("document.querySelector('.meta-items-container a').focus({preventScroll:true});void 0")
            for (move in 0 until 10) {
                js("{const tracks=document.querySelectorAll('.meta-items-container');tracks[39].append(makeCard(39,100+$move));}void 0")
                instrumentation.sendKeyDownUpSync(if (move % 2 == 0) KeyEvent.KEYCODE_DPAD_DOWN else KeyEvent.KEYCODE_DPAD_UP)
                val expected = if (move % 2 == 0) 1 else 0
                val code = "[...document.querySelectorAll('.meta-items-container')].findIndex(t=>t.contains(document.activeElement))"
                val focusDeadline = SystemClock.uptimeMillis() + 2000
                while (js(code) != expected.toString() && SystemClock.uptimeMillis() < focusDeadline) Thread.sleep(20)
                assertEquals("Injected D-pad must move focus to the intended catalog row", expected.toString(), js(code))
            }
            instrumentation.sendStatus(0, Bundle().apply { putString("stream", "[navigation-benchmark] nativeDpadMoves=10 failures=0\n") })
        } finally {
            instrumentation.runOnMainSync { web.destroy() }
            scenario.close()
        }
    }
}
