package com.notdxbi.dxbi.tv

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class OutboxTest {
    @Test fun sanitizedPlaybackEventReachesOnlyItsProfile() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val profile=UUID.randomUUID().toString()
        val work=UUID.randomUUID().toString()
        val received=CountDownLatch(1)
        var payload=""
        val server=MockWebServer()
        server.dispatcher=object:Dispatcher(){override fun dispatch(request:RecordedRequest):MockResponse {
            return when(request.path) {
                "/v1/profiles/$profile/stremio-binding" -> MockResponse().setBody("{\"status\":\"client_runtime_verified\"}")
                "/v1/profiles/$profile/media/resolve" -> MockResponse().setBody(JSONObject().put("work_id",work).put("episode_id",JSONObject.NULL).toString())
                "/v1/sync/events" -> {payload=request.body.readUtf8();received.countDown();MockResponse().setBody("{\"results\":[]}")}
                else -> MockResponse().setResponseCode(404)
            }
        }}
        server.start(InetAddress.getByName("127.0.0.1"),0)
        val vault=SecureStore(context)
        vault.put("sync-config-$profile",JSONObject().put("server",server.url("/").toString().trimEnd('/'))
            .put("credentials",JSONObject().put("access_token","synthetic-access-token").put("refresh_token","synthetic-refresh-token")).toString())
        val sync=HouseholdPlaybackSync(context,profile)
        try {
            sync.verifyIdentity("synthetic-stremio-user")
            sync.record(JSONObject().put("external_id","tt9990001").put("position",20).put("duration",100).put("paused",false)
                .put("season",JSONObject.NULL).put("episode",JSONObject.NULL).put("url","https://example.invalid/never-forward?token=synthetic-private").toString())
            assertTrue("Sanitized progress must upload",received.await(8,TimeUnit.SECONDS))
            val event=JSONObject(payload).getJSONArray("events").getJSONObject(0)
            assertEquals(profile,event.getString("profile_id"));assertEquals(work,event.getString("work_id"))
            assertEquals(20.0,event.getDouble("position"),0.01)
            assertFalse(payload.contains("url"));assertFalse(payload.contains("token"));assertFalse(payload.contains("never-forward"))
        } finally {
            sync.close();server.shutdown()
            for(key in listOf("sync-config-$profile","sync-queue-$profile","stremio-id-$profile"))vault.put(key,null)
        }
    }
}
