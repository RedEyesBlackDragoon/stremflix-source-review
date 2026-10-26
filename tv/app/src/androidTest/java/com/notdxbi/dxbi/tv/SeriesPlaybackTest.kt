package com.notdxbi.dxbi.tv

import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The player's series features and timing steps, with the remote's keys: Up Next, Episodes, held OK */
@RunWith(AndroidJUnit4::class)
class SeriesPlaybackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val server = MockWebServer()
    private val closed = CountDownLatch(1)
    @Volatile private var then: String? = null

    @Before fun serve() {
        instrumentation.uiAutomation.executeShellCommand("settings put secure immersive_mode_confirmations confirmed").use { d ->
            java.io.FileInputStream(d.fileDescriptor).use { it.readBytes() }
        }
        val video = instrumentation.context.assets.open("synthetic-video.mp4").use { it.readBytes() }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = if (request.path!!.endsWith(".vtt"))
                MockResponse().setHeader("Content-Type", "text/vtt").setBody("WEBVTT\n\n00:00.000 --> 00:30.000\nA line\n")
            else MockResponse().setHeader("Content-Type", "video/mp4").setBody(Buffer().write(video))
        }
        server.start(InetAddress.getByName("127.0.0.1"), 0)
        PlaybackBus.listener = object : PlaybackBus.Listener {
            override fun onProgress(positionMs: Long, durationMs: Long, paused: Boolean) {}
            override fun onClosed(positionMs: Long, durationMs: Long, ended: Boolean, error: String?, then: String?) {
                this@SeriesPlaybackTest.then = then; closed.countDown()
            }
        }
    }

    @After fun stop() { PlaybackBus.listener = null; server.shutdown() }

    private fun launch(notifyMs: Long): ActivityScenario<PlayerActivity> {
        val episodes = JSONArray()
        for (e in 1..3) episodes.put(JSONObject().put("id", "s1e$e").put("season", 1).put("episode", e).put("title", "Episode title $e"))
        val series = JSONObject().put("current", "s1e1").put("episodes", episodes).put("binge", true).put("notifyMs", notifyMs)
            .put("next", JSONObject().put("id", "s1e2").put("season", 1).put("episode", 2).put("title", "Episode title 2"))
        val stream = JSONObject().put("url", server.url("/video.mp4").toString()).put("title", "Series fixture").put("series", series)
            .put("subtitles", JSONArray().put(JSONObject().put("url", server.url("/en.vtt").toString()).put("lang", "eng").put("label", "English")))
        return ActivityScenario.launch(Intent(instrumentation.targetContext, PlayerActivity::class.java)
            .putExtra(PlayerActivity.EXTRA_STREAM, stream.toString()))
    }

    /** The first view (in the player's window) whose text or description starts with [text] */
    private fun find(scenario: ActivityScenario<PlayerActivity>, text: String): View? {
        var found: View? = null
        scenario.onActivity { a ->
            fun walk(v: View) {
                if (found != null) return
                val t = (v as? TextView)?.text?.toString() ?: v.contentDescription?.toString()
                if (t != null && t.trim().startsWith(text) && v.isShown) { found = v; return }
                if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
            }
            walk(a.window.decorView)
        }
        return found
    }

    private fun waitFor(timeoutMs: Long, check: () -> Boolean): Boolean {
        val end = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < end) { if (check()) return true; SystemClock.sleep(200) }
        return false
    }

    @Test fun upNextTakesTheRemoteAndPlaysTheNextEpisode() {
        // Up Next from the start: the whole fixture is "the end credits"
        val scenario = launch(notifyMs = 10 * 60_000L)
        try {
            assertTrue("Up Next must show", waitFor(10_000) { find(scenario, "▶  Play now") != null })
            assertTrue("It counts down when binge-watching", find(scenario, "Starts in") != null)
            // once the controls have gone (as they have by an episode's end credits), the remote is on Play now
            scenario.onActivity { a -> a.findViewById<androidx.media3.ui.PlayerView>(R.id.player_view).hideController() }
            assertTrue("Play now must get the remote", waitFor(2_000) { find(scenario, "▶  Play now")?.isFocused == true })
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            assertTrue(closed.await(5, TimeUnit.SECONDS))
            assertEquals("next", then)
        } finally { scenario.close() }
    }

    @Test fun episodesPanelPlaysTheChosenEpisode() {
        val scenario = launch(notifyMs = 1L)
        try {
            assertTrue("Episodes button", waitFor(10_000) { find(scenario, "Episodes") != null })
            val episodes = find(scenario, "Episodes")!!
            scenario.onActivity { episodes.performClick() }
            assertTrue("The panel opens on the episode playing", waitFor(3_000) { find(scenario, "1. Episode title 1")?.parent?.let { (it as View).parent as? View }?.isFocused == true })
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            assertTrue(closed.await(5, TimeUnit.SECONDS))
            assertEquals("episode:s1e2", then)
        } finally { scenario.close() }
    }

    @Test fun soundTimingKeepsThePicturePlaying() {
        val scenario = launch(notifyMs = 1L)
        try {
            assertTrue(waitFor(10_000) {
                var shown = false
                scenario.onActivity { a -> shown = a.findViewById<View>(androidx.media3.ui.R.id.exo_subtitle)?.isShown == true }
                shown
            })
            scenario.onActivity { a -> a.findViewById<View>(androidx.media3.ui.R.id.exo_subtitle).performClick() }
            assertTrue(waitFor(3_000) { find(scenario, "Sound later") != null })
            val later = find(scenario, "Sound later")!!
            scenario.onActivity { later.requestFocus() }
            val down = SystemClock.uptimeMillis()
            for (repeat in 0..7) instrumentation.sendKeySync(KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, repeat))
            instrumentation.sendKeySync(KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER, 0))
            assertTrue(waitFor(2_000) { find(scenario, "Sound 1.1 s later") != null })
            // the picture runs on its moved clock: playback must keep going, not stall waiting for frames
            fun position(): Long { var p = 0L; scenario.onActivity { a ->
                val f = PlayerActivity::class.java.getDeclaredField("player").apply { isAccessible = true }
                p = (f.get(a) as androidx.media3.exoplayer.ExoPlayer).currentPosition }; return p }
            val before = position()
            SystemClock.sleep(3_000)
            assertTrue("Playback must advance with the sound moved (from $before)", position() - before > 2_000)
        } finally { scenario.close() }
    }

    @Test fun holdingOkSpeedsUpTheSubtitleTiming() {
        val scenario = launch(notifyMs = 1L)
        try {
            assertTrue("Subtitles button (there's a subtitle file)", waitFor(10_000) {
                var shown = false
                scenario.onActivity { a -> shown = a.findViewById<View>(androidx.media3.ui.R.id.exo_subtitle)?.isShown == true }
                shown
            })
            scenario.onActivity { a -> a.findViewById<View>(androidx.media3.ui.R.id.exo_subtitle).performClick() }
            assertTrue(waitFor(3_000) { find(scenario, "Subtitles later") != null })
            val later = find(scenario, "Subtitles later")!!
            scenario.onActivity { later.requestFocus() }
            // OK held: one press and nine repeats — 6 × 0.1 s + 4 × 0.25 s = 1.6 s
            val down = SystemClock.uptimeMillis()
            for (repeat in 0..9) instrumentation.sendKeySync(KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, repeat))
            instrumentation.sendKeySync(KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER, 0))
            assertTrue("The offset shows, sped up", waitFor(2_000) { find(scenario, "Subtitles 1.6 s later") != null })
        } finally { scenario.close() }
    }
}
