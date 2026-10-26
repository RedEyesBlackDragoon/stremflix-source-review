package com.notdxbi.dxbi.tv

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LocalProfilesTest {
    @Test fun profilesAndAccountBindingsPersistWithoutBackend() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val key="synthetic-local-test-${UUID.randomUUID()}";val vault=SecureStore(context)
        try {
            val store=LocalProfileStore(context,key)
            val a=store.create("Synthetic A","teal");val b=store.create("Synthetic B","blue")
            store.bind(a.getString("id"),"synthetic-account-one")
            assertThrows(IllegalArgumentException::class.java){store.bind(b.getString("id"),"synthetic-account-one")}
            assertThrows(IllegalArgumentException::class.java){store.bind(a.getString("id"),"synthetic-account-two")}
            val restored=LocalProfileStore(context,key)
            assertEquals(a.getString("id"),restored.publicState("android-tv").getJSONArray("profiles").getJSONObject(0).getString("id"))
            assertTrue(restored.publicState("android-tv").getJSONArray("profiles").getJSONObject(0).getBoolean("linked"))
            assertFalse(restored.publicState("android-tv").toString().contains("314159"))
            restored.remove(a.getString("id"))
            assertEquals(1,restored.publicState("android-tv").getJSONArray("profiles").length())
            restored.bind(b.getString("id"),"synthetic-account-two")
            restored.reset(b.getString("id"))
            val fresh=restored.publicState("android-tv").getJSONArray("profiles").getJSONObject(0)
            assertNotEquals("Reconnect must never reuse the previous authenticated session",b.getString("id"),fresh.getString("id"))
            assertFalse(fresh.getBoolean("linked"))
            assertThrows(IllegalArgumentException::class.java){restored.profile(b.getString("id"))}
            restored.bind(fresh.getString("id"),"synthetic-account-three")
        }finally{vault.put(key,null)}
    }

    @Test fun existingPinSetupMigratesWithoutLosingProfiles() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val key="synthetic-migration-${UUID.randomUUID()}";val vault=SecureStore(context)
        try {
            val id=UUID.randomUUID().toString()
            val legacy=org.json.JSONObject().put("version",1).put("admin",org.json.JSONObject().put("hash","old-verifier"))
                .put("attempts",5).put("lockedUntil",Long.MAX_VALUE).put("profiles",org.json.JSONArray().put(
                    org.json.JSONObject().put("id",id).put("name","Existing viewer").put("avatar","teal").put("accountId","synthetic-account")))
            vault.put(key,legacy.toString())
            val store=LocalProfileStore(context,key)
            assertTrue(store.publicState("android-tv").getBoolean("managementUnlocked"))
            assertEquals("synthetic-account",store.profile(id).getString("accountId"))
            store.create("New viewer","blue")
            store.remove(id)
            assertEquals(1,store.publicState("android-tv").getJSONArray("profiles").length())
            assertFalse(org.json.JSONObject(vault.get(key)!!).has("admin"))
        }finally{vault.put(key,null)}
    }

    @Test fun launcherLoadsBundledLocalUI() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val scenario=ActivityScenario.launch(HouseholdActivity::class.java)
        lateinit var web:WebView
        fun find(view:View):WebView? {
            if(view is WebView)return view
            if(view is ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it}
            return null
        }
        fun js(query:String):String {
            val done=CountDownLatch(1);var answer=""
            instrumentation.runOnMainSync{web.evaluateJavascript(query){answer=it;done.countDown()}}
            assertTrue(done.await(3,TimeUnit.SECONDS));return answer
        }
        try {
            scenario.onActivity{web=find(it.window.decorView) ?: throw AssertionError("Local launcher must create its WebView")}
            val deadline=System.currentTimeMillis()+8000
            while(System.currentTimeMillis()<deadline && js("Boolean(window.LocalHousehold && document.querySelector('#settings'))")!="true")Thread.sleep(100)
            assertEquals("true",js("Boolean(window.LocalHousehold && document.querySelector('#settings'))"))
            val ready=System.currentTimeMillis()+5000
            while(System.currentTimeMillis()<ready && js("document.querySelector('#settings').textContent==='Manage Profiles'")!="true")Thread.sleep(100)
            assertEquals("true",js("document.querySelector('#settings').textContent==='Manage Profiles' && !document.querySelector('input[type=password]')"))
            js("document.querySelector('#settings').click(); void 0;")
            assertEquals("true",js("document.querySelector('h1').textContent==='Manage Profiles' && !document.querySelector('input[type=password]')"))
            assertEquals("true",js("location.href==='https://appassets.androidplatform.net/assets/local/index.html'"))
            assertEquals("true",js("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content.includes(\"connect-src 'none'\")"))
        }finally{scenario.close()}
    }
}
