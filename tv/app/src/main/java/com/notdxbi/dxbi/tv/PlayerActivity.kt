package com.notdxbi.dxbi.tv

import android.net.Uri
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * The native player: plays the stream Stremio picked (MKV, HEVC, HDR and surround sound included,
 * as far as the TV's hardware can), with the addons' subtitles. Reports its position back so the
 * watch progress is kept.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {

    private lateinit var playerView: PlayerView
    private lateinit var titleBar: View
    private lateinit var seekFlash: TextView
    private var player: ExoPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var closed = false
    private var lastError: String? = null
    private var lastText: List<String?> = emptyList()
    private lateinit var startOverlay: View
    private lateinit var errorPanel: View
    private lateinit var tracksPanel: TracksPanel
    private val timing = AvSync()
    private var series: SeriesPlayback? = null
    private var returnContext: JSONObject? = null

    // Up Next over the end credits: checked as playback goes
    private val upNext = object : Runnable {
        override fun run() {
            val exo = player ?: return
            val s = series ?: return
            val duration = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L
            s.tick(exo.currentPosition, duration, playerView.isControllerFullyVisible || overlayOpen())
            handler.postDelayed(this, 500)
        }
    }
    private var firstFrame = false

    // A source that hasn't shown a picture by now isn't going to: offer the way out
    private val startTimeout = Runnable { showError("it's taking too long to start") }
    // Big remuxes can take a while to start from a debrid service: say so before anyone gives up
    private val slowStart = Runnable {
        if (!firstFrame) findViewById<TextView>(R.id.start_detail).text = "Still starting · large 4K sources take a little longer"
    }

    private val reportProgress = object : Runnable {
        override fun run() {
            report()
            handler.postDelayed(this, PROGRESS_INTERVAL_MS)
        }
    }
    private val hideFlash = Runnable { seekFlash.visibility = View.GONE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContentView(R.layout.activity_player)
        playerView = findViewById(R.id.player_view)
        titleBar = findViewById(R.id.title_bar)
        seekFlash = findViewById(R.id.seek_flash)

        val stream = JSONObject(intent.getStringExtra(EXTRA_STREAM) ?: "{}")
        returnContext = stream.optJSONObject("returnContext")
        findViewById<TextView>(R.id.title).text = stream.optString("title")
        findViewById<TextView>(R.id.subtitle).apply {
            text = stream.optString("subtitle")
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
        startOverlay = findViewById(R.id.start_overlay)
        errorPanel = findViewById(R.id.error_panel)
        findViewById<TextView>(R.id.start_title).text = stream.optString("title")
        findViewById<TextView>(R.id.start_detail).text = stream.optString("subtitle").ifEmpty {
            if (stream.optLong("startMs", 0L) > 0) "Resuming from ${clock(stream.optLong("startMs"))}" else "Starting"
        }
        loadBackdrop(stream.optString("background"))
        findViewById<View>(R.id.error_retry).setOnClickListener { retry() }
        // Back to the title's sources, where the next one is a press away
        findViewById<View>(R.id.error_other).setOnClickListener { finishWith() }

        val url = stream.optString("url")
        if (url.isEmpty()) {
            finishWith(error = "no stream address")
            return
        }

        // Addons can ask for headers on their links (Stremio's proxyHeaders)
        val headers = mutableMapOf<String, String>()
        stream.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> headers[k] = h.optString(k) } }
        val http = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
        val dataSource = OkHttpDataSource.Factory(http)
            .setUserAgent("dxbi-tv/${BuildConfigVersion.name(this)}")
            .setDefaultRequestProperties(headers)

        // The TV's own decoders first, falling back to software ones when a format isn't supported,
        // and subtitles that can be moved earlier or later
        val renderers = timing.renderers(this)

        val exo = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(SEEK_STEP_MS)
            .setSeekForwardIncrementMs(SEEK_STEP_MS)
            .build()
        player = exo
        playerView.player = exo
        val frame = findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as android.widget.FrameLayout
        // A series: Episodes, Next Episode and Up Next; a choice closes this player and the page plays it
        series = stream.optJSONObject("series")?.let { s ->
            SeriesPlayback(this, frame, s) { then -> finishWith(ended = exo.playbackState == Player.STATE_ENDED, then = then) }
        }
        remoteFriendlyControls()
        playerView.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
            titleBar.visibility = visibility
            // The remote starts on play/pause, and the arrows move between the controls from there
            if (visibility == View.VISIBLE) playerView.findViewById<View>(androidx.media3.ui.R.id.exo_play_pause)?.requestFocus()
        })

        // Audio & Subtitles (the CC button): the profile's languages from last time; subtitles off
        // unless one was chosen, whatever the file marks as its default
        tracksPanel = TracksPanel(this, frame,
            exo, playerView.subtitleView, timing, TracksPanel.Prefs(this, intent.getStringExtra(EXTRA_PROFILE) ?: "default"))
        // until the profile picks one here: the audio language set in Stremio's settings
        tracksPanel.applyPreferences(stream.optString("audioLanguage").ifEmpty { null }, stream.optString("subtitlesLanguage").ifEmpty { null })
        playerView.findViewById<View>(androidx.media3.ui.R.id.exo_subtitle)?.setOnClickListener { openTracks() }

        val subtitles = mutableListOf<MediaItem.SubtitleConfiguration>()
        stream.optJSONArray("subtitles")?.let { list ->
            for (i in 0 until list.length()) {
                val s = list.optJSONObject(i) ?: continue
                val subUrl = s.optString("url").takeIf { it.isNotEmpty() } ?: continue
                subtitles += MediaItem.SubtitleConfiguration.Builder(Uri.parse(subUrl))
                    .setMimeType(subtitleMime(subUrl))
                    .setLanguage(s.optString("lang").ifEmpty { null })
                    .setLabel(s.optString("label").ifEmpty { s.optString("lang") })
                    .setSelectionFlags(0)
                    .build()
            }
        }

        val item = MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setSubtitleConfigurations(subtitles)
            .build()
        exo.setMediaItem(item, stream.optLong("startMs", 0L).coerceAtLeast(0L))
        exo.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { report() }
            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) { report() }
            override fun onPlaybackStateChanged(state: Int) {
                // the end: on to the next episode when binge-watching (Stremio's setting), else back
                if (state == Player.STATE_ENDED && series?.onEnded() != true) finishWith(ended = true)
            }

            // A subtitle switched on mid-line only shows from its next line: a seek to where we are
            // brings the current one up straight away
            override fun onTracksChanged(tracks: Tracks) {
                val text = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }.flatMap { g -> (0 until g.length).filter { g.isTrackSelected(it) }.map { i -> g.getTrackFormat(i).id } }
                if (text.isNotEmpty() && text != lastText) exo.seekTo(exo.currentPosition)
                lastText = text
            }

            override fun onRenderedFirstFrame() {
                if (firstFrame) return
                firstFrame = true
                handler.removeCallbacks(startTimeout)
                handler.removeCallbacks(slowStart)
                startOverlay.animate().alpha(0f).setDuration(350).withEndAction { startOverlay.visibility = View.GONE }.start()
            }

            override fun onPlayerError(error: PlaybackException) {
                lastError = describe(error)
                showError(lastError!!)
            }
        })
        exo.prepare()
        exo.playWhenReady = true
        handler.postDelayed(reportProgress, PROGRESS_INTERVAL_MS)
        handler.postDelayed(startTimeout, START_TIMEOUT_MS)
        handler.postDelayed(slowStart, SLOW_START_MS)
        if (series?.next != null) handler.postDelayed(upNext, 500)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // Back closes Audio & Subtitles if it's open; otherwise leaves the player straight away, like
            // Netflix (the position is kept)
            // Back closes what's open over the picture (a panel, Up Next); otherwise leaves the player
            override fun handleOnBackPressed() = when {
                ::tracksPanel.isInitialized && tracksPanel.isOpen -> closeOverlay { tracksPanel.close() }
                series?.isOpen == true -> closeOverlay { series?.closeEpisodes() }
                series?.dismissCard() == true -> Unit
                else -> finishWith()
            }
        })
    }

    private fun overlayOpen() = (::tracksPanel.isInitialized && tracksPanel.isOpen) || series?.isOpen == true

    // A panel over the picture (Audio & Subtitles, Episodes); the picture lets go of the remote
    // meanwhile (it would take the focus back as its controls finish hiding)
    private fun openOverlay(open: () -> Unit) {
        series?.hold(true)
        playerView.hideController()
        playerView.isFocusable = false
        playerView.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        open()
    }

    private fun closeOverlay(close: () -> Unit) {
        close()
        series?.hold(false)
        playerView.isFocusable = true
        playerView.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        playerView.showController()
    }

    private fun openTracks() = openOverlay { tracksPanel.open() }

    /**
     * The controls as a remote uses them: the progress bar takes no focus (left/right already skip
     * with the controls hidden, and on the bar they'd scrub instead of moving on), so Down from the
     * middle buttons goes straight to subtitles and settings, and Up comes back.
     */
    private fun remoteFriendlyControls() {
        fun v(id: Int): View? = playerView.findViewById(id)
        v(androidx.media3.ui.R.id.exo_progress)?.apply { isFocusable = false; isFocusableInTouchMode = false }
        // a series adds Next Episode and Episodes at the start of the bottom row
        val bar = v(androidx.media3.ui.R.id.exo_subtitle)?.parent as? ViewGroup
        val seriesButtons = bar?.let { b -> series?.addButtons(b) { openOverlay { series?.openEpisodes() } } } ?: emptyList()
        val bottom = seriesButtons + listOf(androidx.media3.ui.R.id.exo_subtitle, androidx.media3.ui.R.id.exo_settings).mapNotNull { v(it) }
        val middle = listOf(androidx.media3.ui.R.id.exo_rew_with_amount, androidx.media3.ui.R.id.exo_play_pause,
            androidx.media3.ui.R.id.exo_ffwd_with_amount).mapNotNull { v(it) }
        val playPause = v(androidx.media3.ui.R.id.exo_play_pause)
        for (b in bottom) {
            b.setBackgroundResource(R.drawable.control_focus)
            b.nextFocusUpId = playPause?.id ?: View.NO_ID
        }
        // the first bottom button that's showing (the subtitles one only shows when there are subtitles)
        val down = { bottom.firstOrNull { it.visibility == View.VISIBLE } }
        for (m in middle) m.setOnKeyListener { _, keyCode, event ->
            if (keyCode != KeyEvent.KEYCODE_DPAD_DOWN || event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
            down()?.requestFocus() ?: return@setOnKeyListener false
            true
        }
    }

    /** The stream stopped (or never started): say why, and offer Try again / Choose another source */
    private fun showError(reason: String) {
        if (closed || errorPanel.visibility == View.VISIBLE) return
        handler.removeCallbacks(startTimeout)
        handler.removeCallbacks(slowStart)
        player?.pause()
        report()
        playerView.hideController()
        findViewById<TextView>(R.id.error_title).text = "This stream couldn't play"
        findViewById<TextView>(R.id.error_detail).text =
            "${reason.replaceFirstChar { it.uppercase() }}. Try again, or pick another source for this title."
        errorPanel.visibility = View.VISIBLE
        // the picture underneath lets go of the remote while the panel is up
        playerView.isFocusable = false
        playerView.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        findViewById<View>(R.id.error_retry).apply { isFocusableInTouchMode = true; requestFocus() }
        findViewById<View>(R.id.error_other).isFocusableInTouchMode = true
    }

    private fun retry() {
        val exo = player ?: return
        errorPanel.visibility = View.GONE
        if (!firstFrame) startOverlay.apply { alpha = 1f; visibility = View.VISIBLE }
        // from where it stopped; prepare() picks the same item up again after an error
        exo.seekTo(exo.currentPosition)
        exo.prepare()
        exo.playWhenReady = true
        handler.removeCallbacks(startTimeout)
        handler.removeCallbacks(slowStart)
        if (!firstFrame) { handler.postDelayed(startTimeout, START_TIMEOUT_MS); handler.postDelayed(slowStart, SLOW_START_MS) }
        playerView.isFocusable = true
        playerView.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        playerView.requestFocus()
    }

    /** The title's backdrop behind the start screen: fetched off the main thread, faded in if it arrives in time */
    private fun loadBackdrop(url: String) {
        if (!url.startsWith("https://")) return
        Thread {
            val bitmap = try {
                OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build()
                    .newCall(okhttp3.Request.Builder().url(url).build()).execute().use { r ->
                        val bytes = r.body?.bytes()?.takeIf { r.isSuccessful } ?: return@use null
                        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                        var sample = 1
                        while (bounds.outWidth / (sample * 2) >= 1280) sample *= 2
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
                            android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
                    }
            } catch (_: Exception) { null } ?: return@Thread
            runOnUiThread {
                if (closed || firstFrame) return@runOnUiThread
                findViewById<android.widget.ImageView>(R.id.start_backdrop).apply {
                    setImageBitmap(bitmap)
                    animate().alpha(0.6f).setDuration(400).start()
                }
            }
        }.start()
    }

    /**
     * With the controls hidden, the remote works like Netflix's: left/right skip 10 seconds, OK
     * pauses or plays. With the controls showing, the arrows move between them as usual.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val exo = player ?: return super.dispatchKeyEvent(event)
        // The error panel's buttons, the panels' choices, and Up Next (while it has the remote) take the
        // arrows and OK
        if (errorPanel.visibility == View.VISIBLE || overlayOpen() ||
            (series?.cardShowing == true && playerView.findFocus() == null)) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> { exo.playWhenReady = !exo.playWhenReady; playerView.showController(); return true }
                KeyEvent.KEYCODE_MEDIA_PLAY -> { exo.play(); return true }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> { exo.pause(); playerView.showController(); return true }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seek(+1); return true }
                KeyEvent.KEYCODE_MEDIA_REWIND -> { seek(-1); return true }
            }
            if (!playerView.isControllerFullyVisible) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> { seek(-1); return true }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> { seek(+1); return true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                        exo.playWhenReady = !exo.playWhenReady
                        playerView.showController()
                        return true
                    }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> { playerView.showController(); return true }
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun seek(direction: Int) {
        val exo = player ?: return
        if (direction > 0) exo.seekForward() else exo.seekBack()
        seekFlash.text = if (direction > 0) "+10 s   ${clock(exo.currentPosition)}" else "−10 s   ${clock(exo.currentPosition)}"
        seekFlash.visibility = View.VISIBLE
        handler.removeCallbacks(hideFlash)
        handler.postDelayed(hideFlash, 900)
    }

    private fun report() {
        val exo = player ?: return
        val duration = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        PlaybackBus.listener?.onProgress(exo.currentPosition, duration, !exo.isPlaying)
    }

    private fun finishWith(ended: Boolean = false, error: String? = null, then: String? = null) {
        if (closed) return
        closed = true
        handler.removeCallbacksAndMessages(null)
        val exo = player
        val duration = exo?.duration?.takeIf { it != C.TIME_UNSET } ?: 0L
        val position = if (ended) duration else exo?.currentPosition ?: 0L
        val packet = JSONObject().put("timeMs", position).put("durationMs", duration).put("ended", ended)
            .put("error", error ?: JSONObject.NULL).put("then", then ?: JSONObject.NULL)
            .put("context", returnContext ?: JSONObject.NULL)
        setResult(RESULT_OK, Intent().putExtra(EXTRA_CLOSE, packet.toString()))
        PlaybackBus.listener?.onClosed(position, duration, ended, error, then)
        finish()
    }

    override fun onPause() {
        super.onPause()
        // Leaving the app (Home button) pauses, and the progress so far is kept
        player?.pause()
        report()
    }

    override fun onDestroy() {
        if (!closed) finishWith()
        handler.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        super.onDestroy()
    }

    private fun subtitleMime(url: String): String {
        val path = Uri.parse(url).lastPathSegment?.lowercase() ?: ""
        return when {
            path.endsWith(".vtt") -> MimeTypes.TEXT_VTT
            path.endsWith(".ass") || path.endsWith(".ssa") -> MimeTypes.TEXT_SSA
            path.endsWith(".ttml") || path.endsWith(".dfxp") -> MimeTypes.APPLICATION_TTML
            else -> MimeTypes.APPLICATION_SUBRIP
        }
    }

    private fun describe(error: PlaybackException): String = when (error.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "the server refused it"
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "the connection failed"
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "this TV can't decode its video or audio format"
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "its file format isn't supported"
        else -> error.errorCodeName.removePrefix("ERROR_CODE_").lowercase().replace('_', ' ')
    }

    private fun clock(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    companion object {
        const val EXTRA_STREAM = "stream"
        const val EXTRA_PROFILE = "profile"
        const val EXTRA_CLOSE = "playbackClose"
        private const val PROGRESS_INTERVAL_MS = 5000L
        private const val SEEK_STEP_MS = 10_000L
        private const val START_TIMEOUT_MS = 45_000L
        private const val SLOW_START_MS = 12_000L
    }
}
