package com.notdxbi.dxbi.tv

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.Color
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView
import java.util.Locale

/**
 * Audio & Subtitles, made for the remote: the spoken language, the subtitles (or none), and
 * subtitle timing and size. The language choices are remembered for the profile, so the next
 * title starts the same way.
 */
@OptIn(UnstableApi::class)
class TracksPanel(
    private val context: Context,
    private val root: FrameLayout,
    private val player: ExoPlayer,
    private val subtitleView: SubtitleView?,
    private val timing: AvSync,
    private val prefs: Prefs,
) {
    /** What the profile chose last time: languages (null subtitles = off), size, style, all languages or just theirs */
    class Prefs(context: Context, profile: String) {
        private val store = context.getSharedPreferences("player-$profile", Context.MODE_PRIVATE)
        var audioLanguage: String? get() = store.getString("audio", null); set(v) { store.edit().putString("audio", v).apply() }
        var subtitleLanguage: String? get() = store.getString("subtitles", null); set(v) { store.edit().putString("subtitles", v).apply() }
        var size: Int get() = store.getInt("size", 1); set(v) { store.edit().putInt("size", v).apply() }
        var style: Int get() = store.getInt("style", 0); set(v) { store.edit().putInt("style", v).apply() }
        var allLanguages: Boolean get() = store.getBoolean("all-languages", false); set(v) { store.edit().putBoolean("all-languages", v).apply() }
    }

    private var panel: View? = null
    val isOpen get() = panel != null
    private var stremioSubtitles: String? = null

    /** Before playback starts: last time's languages, subtitles off unless one was chosen (never the file's own default) */
    fun applyPreferences(fallbackAudio: String?, stremioSubtitleLanguage: String?) {
        stremioSubtitles = stremioSubtitleLanguage
        val sub = prefs.subtitleLanguage
        // never the file's own pick (a dubbed release marks its dub as the default): the profile's
        // language, else Stremio's setting, else the TV's
        val audio = prefs.audioLanguage ?: fallbackAudio ?: Locale.getDefault().language
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguage(audio)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, sub == null)
            .setPreferredTextLanguage(sub)
            .setSelectUndeterminedTextLanguage(false)
            .setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            .build()
        applyLook()
    }

    fun open(focusSubtitles: Boolean = false) {
        if (panel != null) return
        val dim = FrameLayout(context).apply {
            setBackgroundColor(0xE6000000.toInt())
            isClickable = true
        }
        val columns = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(56), dp(48), dp(56), dp(48))
        }
        val tracks = player.currentTracks
        val audio = column("Audio")
        val audioGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        names(audioGroups, ::audioName).forEach { (group, i, name) ->
            audio.add(name, group.isTrackSelected(i)) {
                select(group, i)
                prefs.audioLanguage = group.getTrackFormat(i).language
            }
        }
        if (audioGroups.isEmpty()) audio.note("Only one audio track")

        val subs = column("Subtitles")
        val textGroups = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        val textOn = !player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) &&
            textGroups.any { it.isSelected }
        subs.add("Off", !textOn) {
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            prefs.subtitleLanguage = null
        }
        // A release can carry dozens of subtitle languages: the viewer's own (and what's on) unless
        // they ask for all of them
        val all = names(textGroups, ::textName)
        val mine = mineLanguages()
        val shownSubs = if (prefs.allLanguages || mine.isEmpty()) all
            else all.filter { (g, i, _) -> (textOn && g.isTrackSelected(i)) || sameLanguage(g.getTrackFormat(i).language, mine) }
        shownSubs.forEach { (group, i, name) ->
            subs.add(name, textOn && group.isTrackSelected(i)) {
                select(group, i)
                prefs.subtitleLanguage = group.getTrackFormat(i).language
            }
        }
        if (shownSubs.size < all.size || prefs.allLanguages && mine.isNotEmpty() && all.any { (g, i, _) -> !sameLanguage(g.getTrackFormat(i).language, mine) }) {
            subs.button(if (prefs.allLanguages) "Only my languages" else "Show all languages (${all.size - shownSubs.size} more)") {
                prefs.allLanguages = !prefs.allLanguages
                close(); open(focusSubtitles = true)
            }
        }

        val options = column("Subtitle timing")
        val subShown = options.label(offsetText(timing.subtitleMs, "Subtitles"))
        options.stepper("Subtitles earlier") { step -> timing.subtitleMs = (timing.subtitleMs - step).coerceIn(-AvSync.MAX_MS, AvSync.MAX_MS); subShown.text = offsetText(timing.subtitleMs, "Subtitles") }
        options.stepper("Subtitles later") { step -> timing.subtitleMs = (timing.subtitleMs + step).coerceIn(-AvSync.MAX_MS, AvSync.MAX_MS); subShown.text = offsetText(timing.subtitleMs, "Subtitles") }
        options.heading("Sound timing")
        val audioShown = options.label(offsetText(timing.audioMs, "Sound"))
        options.stepper("Sound earlier") { step -> timing.audioMs = (timing.audioMs - step).coerceIn(-AvSync.MAX_AUDIO_MS, AvSync.MAX_AUDIO_MS); audioShown.text = offsetText(timing.audioMs, "Sound") }
        options.stepper("Sound later") { step -> timing.audioMs = (timing.audioMs + step).coerceIn(-AvSync.MAX_AUDIO_MS, AvSync.MAX_AUDIO_MS); audioShown.text = offsetText(timing.audioMs, "Sound") }
        options.button("Reset timing") {
            timing.subtitleMs = 0; timing.audioMs = 0
            subShown.text = offsetText(0, "Subtitles"); audioShown.text = offsetText(0, "Sound")
        }
        options.heading("Subtitle size")
        listOf("Small", "Medium", "Large").forEachIndexed { i, label ->
            options.add(label, prefs.size == i) { prefs.size = i; applyLook() }
        }
        options.heading("Subtitle style")
        STYLES.forEachIndexed { i, (label, _) ->
            options.add(label, prefs.style == i) { prefs.style = i; applyLook() }
        }

        for (c in listOf(audio, subs, options)) columns.addView(c.view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        dim.addView(columns, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(dim, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        panel = dim
        // start on what's playing now: the chosen subtitles (or Off)
        (subs.selected ?: subs.first ?: audio.selected ?: audio.first)?.requestFocus()
        if (focusSubtitles) subs.last?.requestFocus()
    }

    /** The viewer's languages: what they picked here, Stremio's subtitle language, the TV's */
    private fun mineLanguages() = listOfNotNull(prefs.subtitleLanguage, stremioSubtitles, Locale.getDefault().language).toSet()

    private fun iso3(code: String?) = code?.takeIf { it.isNotEmpty() && it != "und" }?.let {
        try { Locale.forLanguageTag(it).isO3Language.lowercase() } catch (_: Exception) { it.lowercase() }
    }

    private fun sameLanguage(code: String?, among: Set<String>) = iso3(code)?.let { c -> among.any { iso3(it) == c } } ?: false

    fun close() {
        panel?.let { root.removeView(it) }
        panel = null
    }

    private fun select(group: Tracks.Group, index: Int) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(group.type, false)
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
            .build()
    }

    /** Size and style; the file's own font sizes give way to the chosen size */
    private fun applyLook() {
        val view = subtitleView ?: return
        val scale = listOf(0.8f, 1f, 1.35f).getOrElse(prefs.size) { 1f }
        view.setApplyEmbeddedFontSizes(false)
        view.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale)
        view.setStyle(STYLES.getOrElse(prefs.style) { STYLES[0] }.second)
    }

    private fun offsetText(ms: Long, what: String) = when {
        ms == 0L -> "$what in sync"
        ms > 0 -> "$what %.1f s later".format(ms / 1000f)
        else -> "$what %.1f s earlier".format(-ms / 1000f)
    }

    // ---- names a person can tell apart ------------------------------------------------------------

    private fun language(code: String?) = code?.takeIf { it.isNotEmpty() && it != "und" }
        ?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH).ifEmpty { it } }

    // The release's own track title (a dub studio, "Commentary", "SDH") says the most: shown unless it
    // only repeats the language
    private fun title(f: Format, language: String?): String? {
        var label = f.label?.trim() ?: return null
        if (language != null && label.startsWith(language, ignoreCase = true)) label = label.substring(language.length).trim(' ', '-', '·', '(', ')')
        return label.takeIf { it.isNotEmpty() && !it.equals(f.language, true) }
    }

    /** Language first, then what tells it apart: "English · 5.1 · Atmos", "Russian · Stereo · Dub (Bravo Records)" */
    private fun audioName(f: Format): Pair<String, String> {
        val lang = language(f.language)
        val channels = when (f.channelCount) { 1 -> "Mono"; 2 -> "Stereo"; 6 -> "5.1"; 8 -> "7.1"; else -> null }
        val atmos = if (f.codecs?.contains("ec+3") == true || f.label?.contains("Atmos", true) == true) "Atmos" else null
        return (lang ?: f.label ?: "Audio") to listOfNotNull(channels, atmos, title(f, lang).takeIf { lang != null }).joinToString(" · ")
    }

    private fun textName(f: Format): Pair<String, String> {
        val lang = language(f.language)
        val tags = listOfNotNull(
            "SDH".takeIf { f.roleFlags and C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND != 0 },
            "Forced".takeIf { f.selectionFlags and C.SELECTION_FLAG_FORCED != 0 },
            title(f, lang).takeIf { lang != null },
        )
        return (lang ?: f.label ?: "Subtitles") to tags.joinToString(" · ")
    }

    /** Every playable track with its name; names that still repeat get a number after the language (English 2 · 5.1) */
    private fun names(groups: List<Tracks.Group>, name: (Format) -> Pair<String, String>): List<Triple<Tracks.Group, Int, String>> {
        val all = groups.flatMap { g -> (0 until g.length).filter { g.isTrackSupported(it) }.map { Triple(g, it, name(g.getTrackFormat(it))) } }
        val counts = all.groupingBy { it.third }.eachCount()
        val seen = mutableMapOf<Pair<String, String>, Int>()
        return all.map { (g, i, n) ->
            val first = if ((counts[n] ?: 0) > 1) "${n.first} ${seen.merge(n, 1, Int::plus)}" else n.first
            Triple(g, i, if (n.second.isEmpty()) first else "$first · ${n.second}")
        }
    }

    // ---- the columns ------------------------------------------------------------------------------

    private fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()

    private fun column(title: String) = Column(title)

    private inner class Column(title: String) {
        val list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
        val view = ScrollView(context).apply { isVerticalScrollBarEnabled = false; addView(list) }
        var first: View? = null
        var last: View? = null
        var selected: View? = null
        private val rows = mutableListOf<TextView>()

        init { heading(title) }

        fun heading(text: String) {
            list.addView(TextView(context).apply {
                this.text = text; textSize = 22f; setTypeface(typeface, Typeface.BOLD); setTextColor(0xFFFFFFFF.toInt())
                setPadding(dp(16), dp(18), dp(16), dp(10))
            })
        }

        fun note(text: String) { label(text) }

        fun label(text: String) = TextView(context).apply {
            this.text = text; textSize = 17f; setTextColor(0x99FFFFFF.toInt()); setPadding(dp(16), dp(6), dp(16), dp(10))
        }.also { list.addView(it) }

        /** One choice of several: a check on the chosen one */
        fun add(text: String, on: Boolean, choose: () -> Unit) {
            val row = row(text)
            row.tag = on
            mark(row, on)
            row.setOnClickListener {
                rows.forEach { mark(it, it === row) }
                choose()
            }
            rows += row
            if (on) selected = row
        }

        /** An action: no check */
        fun button(text: String, act: () -> Unit) { row(text).setOnClickListener { act() } }

        /** A timing step: OK nudges it, and holding OK nudges faster (0.1 s, then 0.25 s, then 0.5 s) */
        fun stepper(text: String, nudge: (Long) -> Unit) {
            row(text).apply {
                setOnClickListener { nudge(AvSync.step(0)) }
                setOnKeyListener { _, keyCode, event ->
                    val ok = keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                    if (ok && event.action == KeyEvent.ACTION_DOWN) nudge(AvSync.step(event.repeatCount))
                    ok
                }
            }
        }

        private fun row(text: String) = TextView(context).apply {
            this.text = text; textSize = 19f; setTextColor(0xFFFFFFFF.toInt())
            setPadding(dp(16), dp(12), dp(16), dp(12)); gravity = Gravity.CENTER_VERTICAL
            isFocusable = true; isFocusableInTouchMode = true
            background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(0) }
            setOnFocusChangeListener { v, has ->
                ((v.background as GradientDrawable)).setColor(if (has) 0xFFFFFFFF.toInt() else 0)
                (v as TextView).setTextColor(if (has) 0xFF000000.toInt() else 0xFFFFFFFF.toInt())
            }
        }.also {
            list.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(4) })
            if (first == null) first = it
            last = it
        }

        private fun mark(row: TextView, on: Boolean) {
            val name = row.text.toString().removePrefix("✓  ").removePrefix("    ")
            row.text = if (on) "✓  $name" else "    $name"
            row.setTypeface(null, if (on) Typeface.BOLD else Typeface.NORMAL)
        }
    }

    companion object {
        /** Subtitle looks, made to read well over any picture: a soft shadow (Netflix's look), a box, or yellow */
        val STYLES = listOf(
            "Shadow" to CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW, Color.BLACK, null),
            "Boxed" to CaptionStyleCompat(Color.WHITE, 0xB3000000.toInt(), Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_NONE, Color.BLACK, null),
            "Yellow" to CaptionStyleCompat(0xFFFFE14D.toInt(), Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null),
        )
    }
}
