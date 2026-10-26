package com.notdxbi.dxbi.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.Timeline
import androidx.media3.common.util.Clock
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.RendererConfiguration
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.SampleStream
import androidx.media3.exoplayer.text.TextOutput
import androidx.media3.exoplayer.video.VideoRendererEventListener

/**
 * Subtitle and audio timing, for a file whose subtitles or sound are early or late against the
 * picture (Stremio's player has both). Media3 has neither, so renderers are handed a moved playback
 * position: the subtitles by [subtitleMs] (positive shows each line later), and the picture by
 * [audioMs] (positive puts the picture ahead, so the sound comes later). Subtitles follow the picture.
 * The sound itself is the clock, so it's never touched.
 */
@OptIn(UnstableApi::class)
class AvSync {
    @Volatile var subtitleMs = 0L
    @Volatile var audioMs = 0L

    /** The TV's decoders first, software ones as a fallback (as before), with both timings */
    fun renderers(context: Context) = object : DefaultRenderersFactory(context) {
        override fun buildTextRenderers(context: Context, output: TextOutput, outputLooper: Looper,
                                        extensionRendererMode: Int, out: ArrayList<Renderer>) {
            val built = ArrayList<Renderer>()
            super.buildTextRenderers(context, output, outputLooper, extensionRendererMode, built)
            built.mapTo(out) { Shifted(it) { (audioMs - subtitleMs) * 1000 } }
        }

        override fun buildVideoRenderers(context: Context, extensionRendererMode: Int, mediaCodecSelector: MediaCodecSelector,
                                         enableDecoderFallback: Boolean, eventHandler: Handler, eventListener: VideoRendererEventListener,
                                         allowedVideoJoiningTimeMs: Long, out: ArrayList<Renderer>) {
            val built = ArrayList<Renderer>()
            super.buildVideoRenderers(context, extensionRendererMode, mediaCodecSelector, enableDecoderFallback, eventHandler,
                eventListener, allowedVideoJoiningTimeMs, built)
            built.mapTo(out) { Shifted(it) { audioMs * 1000 } }
        }
    }.setEnableDecoderFallback(true).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

    /** Everything passed straight through, except where in the video the renderer thinks it is */
    private class Shifted(private val inner: Renderer, private val shiftUs: () -> Long) : Renderer by inner {
        override fun render(positionUs: Long, elapsedRealtimeUs: Long) = inner.render(positionUs + shiftUs(), elapsedRealtimeUs)
        override fun handleMessage(messageType: Int, message: Any?) = inner.handleMessage(messageType, message)
        override fun init(index: Int, playerId: PlayerId, clock: Clock) = inner.init(index, playerId, clock)
        override fun enable(configuration: RendererConfiguration, formats: Array<Format>, stream: SampleStream, positionUs: Long,
                            joining: Boolean, mayRenderStartOfStream: Boolean, startPositionUs: Long, offsetUs: Long,
                            mediaPeriodId: MediaSource.MediaPeriodId) =
            inner.enable(configuration, formats, stream, positionUs, joining, mayRenderStartOfStream, startPositionUs, offsetUs, mediaPeriodId)
        override fun setTimeline(timeline: Timeline) = inner.setTimeline(timeline)
        // (Kotlin's delegation skips the interface's default methods: pass those on by hand)
        override fun getDurationToProgressUs(positionUs: Long, elapsedRealtimeUs: Long) = inner.getDurationToProgressUs(positionUs, elapsedRealtimeUs)
        override fun setPlaybackSpeed(currentPlaybackSpeed: Float, targetPlaybackSpeed: Float) = inner.setPlaybackSpeed(currentPlaybackSpeed, targetPlaybackSpeed)
        override fun enableMayRenderStartOfStream() = inner.enableMayRenderStartOfStream()
        override fun release() = inner.release()
    }

    companion object {
        /** Holding OK speeds the steps up: 0.1 s, then 0.25 s, then 0.5 s */
        fun step(repeat: Int) = when { repeat < 6 -> 100L; repeat < 16 -> 250L; else -> 500L }
        const val MAX_MS = 10_000L
        const val MAX_AUDIO_MS = 3_000L
    }
}
