package com.notdxbi.dxbi.tv

import android.content.Intent
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicit hardware check. Uses existing session; never changes profiles, addons or media state. */
@RunWith(AndroidJUnit4::class)
class TvRemoteRepeatTest {
    @Test fun heldUpMovesOneCatalogRowForEachNativeRepeat() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveTv")=="true")
        val context=instrumentation.targetContext
        val profiles=LocalProfileStore(context).publicState("android-tv").getJSONArray("profiles")
        assertTrue("Create and sign in to a TV viewer before this hardware check",profiles.length()>0)
        val id=profiles.getJSONObject(0).getString("id")
        val scenario=ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java).putExtra("profileUuid",id).putExtra("localProfile",true))
        fun find(view:View):WebView? {if(view is WebView)return view;if(view is ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it};return null}
        lateinit var web:WebView
        fun js(code:String):String {val done=CountDownLatch(1);var result="";instrumentation.runOnMainSync{web.evaluateJavascript(code){result=it;done.countDown()}};assertTrue(done.await(3,TimeUnit.SECONDS));return result}
        fun await(code:String,seconds:Int=30){val deadline=SystemClock.uptimeMillis()+seconds*1000;while(SystemClock.uptimeMillis()<deadline){if(js(code)=="true")return;Thread.sleep(100)};assertEquals("Expected TV navigation state","true",js(code))}
        try {
            scenario.onActivity{web=find(it.window.decorView) ?: throw AssertionError("Missing vendor WebView")}
            await("Boolean(window.__dxbi)")
            js("location.hash='#/';void 0;")
            val rows="[...document.querySelectorAll('[class*=\"meta-row-container\"]')].filter(n=>n.checkVisibility()&&n.querySelector('[class*=\"meta-item-container\"]'))"
            await("$rows.length>=6")
            js("{const rows=$rows;rows[5].scrollIntoView({block:'center',behavior:'instant'});rows[5].querySelector('[class*=\"meta-item-container\"] a[href]').focus({preventScroll:true});}void 0;")
            val down=SystemClock.uptimeMillis()
            try {
                for(repeat in 0..4){
                    instrumentation.sendKeySync(KeyEvent(down,SystemClock.uptimeMillis(),KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_UP,repeat,0,KeyCharacterMap.VIRTUAL_KEYBOARD,0,0,InputDevice.SOURCE_DPAD))
                    Thread.sleep(60)
                }
                await("$rows.indexOf(document.activeElement.closest('[class*=\"meta-row-container\"]'))===0",1)
            }finally{instrumentation.sendKeySync(KeyEvent(down,SystemClock.uptimeMillis(),KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_UP,0))}
        }finally{scenario.close()}
    }
}
