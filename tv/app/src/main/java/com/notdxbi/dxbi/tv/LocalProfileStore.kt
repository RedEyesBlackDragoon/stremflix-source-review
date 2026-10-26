package com.notdxbi.dxbi.tv

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Device-owned profiles. Vendor credentials remain exclusively in WebView's isolated profiles. */
class LocalProfileStore(context: Context, private val keyName:String="local-household") {
    private val vault=SecureStore(context)
    private fun read():JSONObject {
        val saved=vault.get(keyName)
        require(saved!=null || !vault.contains(keyName)){"Local profiles could not be unlocked on this device"}
        val state=saved?.let {JSONObject(it)} ?: JSONObject().put("version",2).put("profiles",JSONArray())
        if(state.optInt("version")==1){
            state.put("version",2);state.remove("admin");state.remove("attempts");state.remove("lockedUntil");save(state)
        }
        return state
    }
    private fun save(state:JSONObject){vault.put(keyName,state.toString())}
    fun publicState(platform:String):JSONObject = synchronized(lock) {
        val state=read();val list=state.getJSONArray("profiles");val public=JSONArray()
        for(i in 0 until list.length()){val p=list.getJSONObject(i);public.put(JSONObject().put("id",p.getString("id")).put("name",p.getString("name"))
            .put("avatar",p.getString("avatar")).put("linked",!p.isNull("accountId")))}
        JSONObject().put("configured",true).put("managementUnlocked",true).put("platform",platform).put("profiles",public)
    }
    fun create(name:String,avatar:String):JSONObject = synchronized(lock) {
        val state=read();val profiles=state.getJSONArray("profiles")
        require(name.trim().isNotEmpty() && name.trim().length<=60 && avatar in avatars){"Choose a name and avatar"}
        require(profiles.length()<20){"This device already has 20 profiles"}
        val profile=JSONObject().put("id",UUID.randomUUID().toString()).put("name",name.trim()).put("avatar",avatar).put("accountId",JSONObject.NULL)
        profiles.put(profile);save(state);JSONObject(profile.toString())
    }
    fun profile(id:String):JSONObject = synchronized(lock){find(read(),id)}
    private fun find(state:JSONObject,id:String):JSONObject {
        val profiles=state.getJSONArray("profiles")
        return (0 until profiles.length()).map {profiles.getJSONObject(it)}.firstOrNull {it.getString("id")==id}
            ?: throw IllegalArgumentException("Profile not found on this device")
    }
    fun bind(id:String,accountId:String)=synchronized(lock){
        require(Regex("[a-zA-Z0-9_-]{1,128}").matches(accountId)){"The Stremio account could not be verified"}
        val state=read();val profile=find(state,id)
        require(profile.isNull("accountId") || profile.getString("accountId")==accountId){"Sign in with this profile’s original Stremio account"}
        val profiles=state.getJSONArray("profiles")
        require((0 until profiles.length()).none {val p=profiles.getJSONObject(it);p.getString("id")!=id && p.optString("accountId")==accountId}){"This Stremio account is already linked to another profile"}
        if(profile.isNull("accountId")){profile.put("accountId",accountId);save(state)}
    }
    fun remove(id:String)=synchronized(lock){
        val state=read();find(state,id);val profiles=state.getJSONArray("profiles");val keep=JSONArray()
        for(i in 0 until profiles.length()){val p=profiles.getJSONObject(i);if(p.getString("id")!=id)keep.put(p)}
        state.put("profiles",keep);save(state)
    }
    fun reset(id:String)=synchronized(lock){val state=read();find(state,id).put("accountId",JSONObject.NULL).put("id",UUID.randomUUID().toString());save(state)}
    companion object {private val lock=Any();private val avatars=setOf("teal","plum","coral","blue","gold")}
}
