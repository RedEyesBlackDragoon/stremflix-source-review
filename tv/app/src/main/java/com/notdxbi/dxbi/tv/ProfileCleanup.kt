package com.notdxbi.dxbi.tv

import android.content.Context
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature

/** WebView forbids deleting profiles loaded in this process. Retry before loading any next launch. */
object ProfileCleanup {
    fun remove(context:Context,id:String) {
        val prefs=context.getSharedPreferences("profile-cleanup",Context.MODE_PRIVATE)
        val pending=prefs.getStringSet("pending",emptySet())!!.toMutableSet()
        pending.add(id)
        check(prefs.edit().putStringSet("pending",pending).commit())
        drain(context)
    }
    fun drain(context:Context) {
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE))return
        val prefs=context.getSharedPreferences("profile-cleanup",Context.MODE_PRIVATE)
        val pending=prefs.getStringSet("pending",emptySet())!!.toMutableSet()
        for(id in pending.toList())try {
            java.util.UUID.fromString(id)
            ProfileStore.getInstance().deleteProfile(id)
            pending.remove(id)
        }catch(_:IllegalStateException){ /* Loaded profile: next process start will retry. */ }
        check(prefs.edit().putStringSet("pending",pending).commit())
    }
}
