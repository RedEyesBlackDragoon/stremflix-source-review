package com.notdxbi.dxbi.tv

import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class IsolationTest {
    @Test fun cookieAndStorageProfilesAreDistinct() {
        assumeTrue("MULTI_PROFILE unavailable: account isolation gate is unverified", WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE))
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val ids=listOf(UUID.randomUUID().toString(),UUID.randomUUID().toString())
        val views=mutableListOf<WebView>()
        instrumentation.runOnMainSync {
            for(id in ids) {
                val view=WebView(context)
                WebViewCompat.setProfile(view,id)
                view.settings.javaScriptEnabled=true
                views.add(view)
            }
            WebViewCompat.getProfile(views[0]).cookieManager.setCookie("https://web.stremio.com","synthetic_identity=A; Secure; SameSite=Strict")
            WebViewCompat.getProfile(views[0]).cookieManager.flush()
            assertFalse(WebViewCompat.getProfile(views[1]).cookieManager.getCookie("https://web.stremio.com")?.contains("synthetic_identity=A") ?: false)
            assertNotEquals(WebViewCompat.getProfile(views[0]).name,WebViewCompat.getProfile(views[1]).name)
        }
        val loaded=CountDownLatch(2)
        instrumentation.runOnMainSync {
            views.forEach { view ->
                view.webViewClient=object:android.webkit.WebViewClient(){ override fun onPageFinished(v:WebView,url:String){loaded.countDown()} }
                view.loadDataWithBaseURL("https://web.stremio.com/","<html><body>Synthetic profile isolation fixture</body></html>","text/html","UTF-8",null)
            }
        }
        assertTrue(loaded.await(15,TimeUnit.SECONDS))
        val stored=CountDownLatch(1)
        instrumentation.runOnMainSync { views[0].evaluateJavascript("localStorage.setItem('synthetic_profile','A')"){stored.countDown()} }
        assertTrue(stored.await(5,TimeUnit.SECONDS))
        val checked=CountDownLatch(1)
        var isolated=""
        instrumentation.runOnMainSync { views[1].evaluateJavascript("localStorage.getItem('synthetic_profile')"){isolated=it;checked.countDown()} }
        assertTrue(checked.await(5,TimeUnit.SECONDS));assertEquals("null",isolated)
        instrumentation.runOnMainSync { views.forEach { it.destroy() } }
    }

    @Test fun keystoreVaultRoundTripAndDelete() {
        val store=SecureStore(InstrumentationRegistry.getInstrumentation().targetContext)
        val key="synthetic-test-${UUID.randomUUID()}"
        store.put(key,"synthetic-test-value")
        assertEquals("synthetic-test-value",store.get(key))
        store.put(key,null);assertNull(store.get(key))
    }
}
