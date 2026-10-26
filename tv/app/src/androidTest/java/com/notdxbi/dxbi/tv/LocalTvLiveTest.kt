package com.notdxbi.dxbi.tv

import android.content.Context
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicit opt-in: public Stremio sign-in surface only. No credentials are entered. */
@RunWith(AndroidJUnit4::class)
class LocalTvLiveTest {
    @Test fun remoteProfileSelectionOpensGenuineStremioSignInWithoutHouseholdServer() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveStremio")=="true")
        val context=instrumentation.targetContext
        assumeTrue((context.getSystemService(Context.UI_MODE_SERVICE) as android.app.UiModeManager).currentModeType==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)
        val vault=SecureStore(context)
        assumeFalse("Do not replace existing device profiles",vault.contains("local-household"))
        val store=LocalProfileStore(context)
        val a=store.create("Synthetic TV A","teal");val b=store.create("Synthetic TV B","blue")
        val scenario=ActivityScenario.launch(HouseholdActivity::class.java)
        fun find(view:View):WebView? {if(view is WebView)return view;if(view is ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it};return null}
        fun js(web:WebView,query:String):String {val done=CountDownLatch(1);var answer="";instrumentation.runOnMainSync{web.evaluateJavascript(query){answer=it;done.countDown()}};assertTrue(done.await(3,TimeUnit.SECONDS));return answer}
        fun await(web:WebView,query:String,seconds:Int=15){val deadline=System.currentTimeMillis()+seconds*1000;while(System.currentTimeMillis()<deadline){if(js(web,query)=="true")return;Thread.sleep(100)};assertEquals(query+"; DOM="+js(web,"JSON.stringify({url:location.href,focus:document.activeElement?.outerHTML,body:document.body?.innerText.slice(0,600)})"),"true",js(web,query))}
        var vendor:MainActivity?=null
        try {
            lateinit var picker:WebView
            scenario.onActivity{picker=find(it.window.decorView) ?: throw AssertionError("Missing local profile picker")}
            await(picker,"document.querySelectorAll('.profile').length===2")
            js(picker,"document.querySelector('.profile').focus(); void 0;")
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            await(picker,"document.activeElement.getAttribute('aria-label')==='Synthetic TV B'")
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            val deadline=System.currentTimeMillis()+15000
            while(vendor==null && System.currentTimeMillis()<deadline){instrumentation.runOnMainSync{vendor=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull()};Thread.sleep(100)}
            assertNotNull("Remote OK must open the selected profile",vendor)
            lateinit var web:WebView
            instrumentation.runOnMainSync{web=find(vendor!!.window.decorView) ?: throw AssertionError("Missing isolated Stremio WebView")}
            await(web,"location.origin==='https://web.stremio.com' && Boolean(document.body && document.body.children.length)",30)
            js(web,"location.hash='#/intro?form=login'; void 0;")
            await(web,"Boolean(document.querySelector('input[type=password]'))",30)
            await(web,"Boolean(window.__householdAdapter)")
            js(web,"window.__liveIdentity='pending';window.__householdAdapter.identity().then(id=>{window.__liveIdentity=id}).catch(()=>{});void 0;")
            await(web,"window.__liveIdentity===null")
            assertEquals(b.getString("id"),vendor!!.profileUuid)
        }finally{
            instrumentation.runOnMainSync{vendor?.finish()}
            scenario.close()
            val closeDeadline=System.currentTimeMillis()+5000
            while(vendor?.isDestroyed==false && System.currentTimeMillis()<closeDeadline){instrumentation.waitForIdleSync();Thread.sleep(50)}
            instrumentation.runOnMainSync{for(profile in listOf(a,b))ProfileCleanup.remove(context,profile.getString("id"))}
            vault.put("local-household",null)
            for(profile in listOf(a,b))vault.removePrefix("plugin-settings-${profile.getString("id")}-")
        }
    }
}
