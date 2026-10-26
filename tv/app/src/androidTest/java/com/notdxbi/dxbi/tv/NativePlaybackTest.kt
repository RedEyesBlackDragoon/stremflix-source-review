package com.notdxbi.dxbi.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativePlaybackTest {
    @Test fun syntheticVideoPlaysPausesAndReportsExitPosition() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        // Establish the emulator precondition: Android's fullscreen tutorial has been acknowledged.
        instrumentation.uiAutomation.executeShellCommand("settings put secure immersive_mode_confirmations confirmed").use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
        val fixture=instrumentation.context.assets.open("synthetic-video.mp4").use { it.readBytes() }
        val server=MockWebServer()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest)=MockResponse()
            .setHeader("Content-Type","video/mp4").setBody(Buffer().write(fixture))}
        server.start(InetAddress.getByName("127.0.0.1"),0)
        val playing=CountDownLatch(1)
        val paused=CountDownLatch(1)
        val closed=CountDownLatch(1)
        var finalPosition=0L
        var error:String?=null
        PlaybackBus.listener=object:PlaybackBus.Listener {
            override fun onProgress(positionMs:Long,durationMs:Long,isPaused:Boolean) {
                if(!isPaused && positionMs>500 && durationMs>5000)playing.countDown()
                if(isPaused && positionMs>500)paused.countDown()
            }
            override fun onClosed(positionMs:Long,durationMs:Long,ended:Boolean,failure:String?,then:String?) {
                finalPosition=positionMs;error=failure;closed.countDown()
            }
        }
        val stream=JSONObject().put("url",server.url("/synthetic.mp4").toString()).put("title","Synthetic playback fixture")
        val scenario=ActivityScenario.launch<PlayerActivity>(Intent(context,PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_STREAM,stream.toString()))
        try {
            assertTrue("Native video must advance while playing",playing.await(10,TimeUnit.SECONDS))
            val television=(context.getSystemService(android.content.Context.UI_MODE_SERVICE) as android.app.UiModeManager).currentModeType==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
            if(television) instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PAUSE)
            else scenario.onActivity { activity -> activity.findViewById<android.view.View>(androidx.media3.ui.R.id.exo_play_pause).performClick() }
            assertTrue("Pause must report progress",paused.await(5,TimeUnit.SECONDS))
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            assertTrue("Back must report the final position",closed.await(5,TimeUnit.SECONDS))
            assertTrue(finalPosition>500);assertNull(error)
        } finally {scenario.close();PlaybackBus.listener=null;server.shutdown()}
    }
}
