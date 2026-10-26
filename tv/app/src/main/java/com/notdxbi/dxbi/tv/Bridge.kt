package com.notdxbi.dxbi.tv

import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject

/** What the page (dxbi-tv.js) can ask the app for: the plugin, its settings, and playback. */
class Bridge(private val activity: MainActivity) {

    private val vault = SecureStore(activity)
    private fun settingKey(plugin: String) = "plugin-settings-${activity.profileUuid}-$plugin"

    /** The Stremflix plugin: the one built in, or a newer one it has updated itself to */
    @JavascriptInterface
    fun pluginSource(): String = try {
        activity.assets.open("dxbi.plugin.js").bufferedReader().use { it.readText() }
    } catch (_: Exception) {
        ""
    }

    /** A plugin's saved settings, as a JSON object (what Stremio Enhanced keeps in <plugin>.plugin.json) */
    @JavascriptInterface
    fun getSettings(plugin: String): String = vault.get(settingKey(plugin)) ?: "{}"

    @JavascriptInterface
    fun saveSetting(plugin: String, key: String, valueJson: String) {
        synchronized(this) {
            val all = try { JSONObject(vault.get(settingKey(plugin)) ?: "{}") } catch (_: Exception) { JSONObject() }
            val value: Any? = try { JSONObject("{\"v\":$valueJson}").opt("v") } catch (_: Exception) { valueJson }
            all.put(key, value ?: JSONObject.NULL)
            vault.put(settingKey(plugin), all.toString())
        }
    }

    @JavascriptInterface
    fun play(json: String) {
        activity.runOnUiThread { activity.play(json) }
    }

    @JavascriptInterface
    fun openExternal(url: String) {
        activity.runOnUiThread { activity.openExternal(url) }
    }

    @JavascriptInterface
    fun toast(text: String) {
        activity.runOnUiThread { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() }
    }

    @JavascriptInterface
    fun version(): String = BuildConfigVersion.name(activity)

    /** Who's watching: { name, avatar } for the header avatar and profile menu ({} without a local profile) */
    @JavascriptInterface
    fun profile(): String = activity.profileJson()

    @JavascriptInterface
    fun switchProfile() { activity.runOnUiThread { activity.switchProfile() } }

    @JavascriptInterface
    fun householdProgress(json: String) { if (json.length <= 2048) activity.householdProgress(json) }

    @JavascriptInterface
    fun verifyIdentity(identity: String) { activity.verifyIdentity(identity) }
}
