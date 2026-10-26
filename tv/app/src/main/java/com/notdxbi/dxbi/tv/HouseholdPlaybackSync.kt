package com.notdxbi.dxbi.tv

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Keystore-encrypted, profile-owned outbox. Its schema has no stream URL or third-party token fields. */
class HouseholdPlaybackSync(context: Context, private val profileId: String) {
    private val vault=SecureStore(context)
    private val executor=Executors.newSingleThreadExecutor()
    private val client=OkHttpClient.Builder().callTimeout(8,TimeUnit.SECONDS).followRedirects(false).build()
    private var lastKey=""
    private var session=UUID.randomUUID().toString()
    private var lastPosition=-1.0
    private var lastPaused=true
    private var lastTime=0L
    private val queueName="sync-queue-$profileId"
    @Volatile var identityVerified=false
        private set

    fun verifyIdentity(identity: String) {
        if(executor.isShutdown || !Regex("[a-zA-Z0-9_-]{1,128}").matches(identity))return
        executor.execute {
            val known=vault.get("stremio-id-$profileId")
            if(known!=null){identityVerified=known==identity;return@execute}
            try {
                val config=JSONObject(vault.get("sync-config-$profileId") ?: return@execute)
                val response=post(config.getString("server"),config.getJSONObject("credentials").getString("access_token"),
                    "/v1/profiles/$profileId/stremio-binding",JSONObject().put("stremio_user_id",identity).put("verification_method","authenticated_isolated_runtime"))
                if(response.first in 200..299){vault.put("stremio-id-$profileId",identity);identityVerified=true}
            } catch (_: Exception) { identityVerified=false }
        }
    }

    fun record(raw: String) {
        if(executor.isShutdown)return
        val observedAt=System.currentTimeMillis()
        executor.execute {
            if(!identityVerified)return@execute
            try {
                val input=JSONObject(raw)
                val external=input.getString("external_id")
                val position=input.getDouble("position");val duration=input.getDouble("duration")
                val paused=input.getBoolean("paused")
                require(Regex("tt\\d{4,12}").matches(external) && position.isFinite() && duration.isFinite() && position>=0 && duration>0 && duration<=604800 && position<=duration+30)
                val season=if(input.isNull("season"))JSONObject.NULL else input.getInt("season")
                val episode=if(input.isNull("episode"))JSONObject.NULL else input.getInt("episode")
                val key="$external:$season:$episode"
                val now=observedAt
                val started=key!=lastKey
                if(!started && paused==lastPaused && ((paused && position==lastPosition) || now-lastTime<15000))return@execute
                if(started)session=UUID.randomUUID().toString()
                val queue=JSONArray(vault.get(queueName) ?: "[]")
                require(queue.length()<10000)
                queue.put(JSONObject().put("id",UUID.randomUUID().toString()).put("external_id",external)
                    .put("season",season).put("episode",episode).put("position",position).put("duration",duration)
                    .put("occurred",now/1000.0).put("playback_session",session)
                    .put("event_type",if(started)"started" else if(paused)"paused" else "heartbeat"))
                vault.put(queueName,queue.toString())
                lastKey=key;lastTime=now;lastPosition=position;lastPaused=paused
                flush(queue)
            } catch (_: Exception) { /* The durable queue is retried when progress next arrives or a profile is reopened. */ }
        }
    }

    private fun post(server: String, token: String, route: String, body: JSONObject): Pair<Int,JSONObject> {
        val request=Request.Builder().url(server+route).header("Authorization","Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        return client.newCall(request).execute().use { Pair(it.code,JSONObject(it.body?.string() ?: "{}")) }
    }

    private fun flush(queue: JSONArray) {
        val config=JSONObject(vault.get("sync-config-$profileId") ?: return)
        val server=config.getString("server")
        var credentials=config.getJSONObject("credentials")
        fun send(route: String, body: JSONObject): JSONObject {
            var response=post(server,credentials.getString("access_token"),route,body)
            if(response.first==401) {
                val refreshed=post(server,"","/v1/auth/refresh",JSONObject().put("refresh_token",credentials.getString("refresh_token")))
                require(refreshed.first==200)
                credentials=refreshed.second;config.put("credentials",credentials);vault.put("sync-config-$profileId",config.toString())
                response=post(server,credentials.getString("access_token"),route,body)
            }
            require(response.first in 200..299);return response.second
        }
        while(queue.length()>0) {
            val item=queue.getJSONObject(0)
            val identity=send("/v1/profiles/$profileId/media/resolve",JSONObject().put("external_id",item.getString("external_id"))
                .put("season",item.opt("season")).put("episode",item.opt("episode")))
            val event=JSONObject()
            for(key in listOf("id","position","duration","occurred","playback_session","event_type"))event.put(key,item.get(key))
            event.put("profile_id",profileId).put("work_id",identity.getString("work_id")).put("episode_id",identity.opt("episode_id"))
            send("/v1/sync/events",JSONObject().put("events",JSONArray().put(event)))
            queue.remove(0);vault.put(queueName,queue.toString())
        }
    }

    init { executor.execute { try { flush(JSONArray(vault.get(queueName) ?: "[]")) } catch (_: Exception) { } } }
    fun close() { executor.shutdown() }
}
