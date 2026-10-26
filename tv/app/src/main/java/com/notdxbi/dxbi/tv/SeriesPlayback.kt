package com.notdxbi.dxbi.tv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * A series in the player, the way Stremio's own player has it: an Episodes panel to jump to any
 * episode, a Next Episode button, and Up Next over the end credits (playing it by itself when
 * Stremio's binge-watching setting is on). The page does the actual navigation: the choice goes back
 * as "next" or "episode:<video id>" ([choose]).
 */
class SeriesPlayback(
    private val context: Context,
    private val root: FrameLayout,
    json: JSONObject,
    private val choose: (String) -> Unit,
) {
    class Episode(val id: String, val season: Int, val episode: Int, val title: String, val thumb: String, val watched: Boolean) {
        val label get() = if (season > 0) "S$season E$episode" else "Episode $episode"
    }

    private val current = json.optString("current")
    private val episodes = json.optJSONArray("episodes")?.let { list ->
        (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map {
            Episode(it.optString("id"), it.optInt("season"), it.optInt("episode"), it.optString("title"), it.optString("thumb"), it.optBoolean("watched"))
        }
    } ?: emptyList()
    val next = json.optJSONObject("next")?.let { Episode(it.optString("id"), it.optInt("season"), it.optInt("episode"), it.optString("title"), it.optString("thumb"), false) }
    private val binge = json.optBoolean("binge", true)
    private val notifyMs = json.optLong("notifyMs", 35_000L).takeIf { it > 0 } ?: 35_000L

    // ---- Episodes panel ---------------------------------------------------------------------------

    private var panel: View? = null
    val isOpen get() = panel != null
    val hasEpisodes get() = episodes.size > 1

    fun openEpisodes() {
        if (panel != null || !hasEpisodes) return
        val seasons = episodes.map { it.season }.distinct().sorted()
        val now = episodes.firstOrNull { it.id == current }
        val dim = FrameLayout(context).apply { setBackgroundColor(0xE6000000.toInt()); isClickable = true }
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(56), dp(40), dp(56), dp(40)) }
        val list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(context).apply { isVerticalScrollBarEnabled = false; addView(list) }

        fun show(season: Int, focusCurrent: Boolean) {
            list.removeAllViews()
            list.addView(heading(if (season > 0) "Season $season" else "Episodes"))
            var focus: View? = null
            for (e in episodes.filter { it.season == season }) {
                val item = episodeRow(e)
                list.addView(item, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(6) })
                if (e.id == current) focus = item
            }
            if (focusCurrent) (focus ?: list.getChildAt(1))?.let { v -> v.requestFocus(); scroll.post { scroll.scrollTo(0, (v.top - (scroll.height - v.height) / 2).coerceAtLeast(0)) } }
        }

        if (seasons.size > 1) {
            val seasonList = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 0, dp(32), 0) }
            seasonList.addView(heading("Seasons"))
            for (s in seasons) {
                // the episodes follow the season the remote is on
                seasonList.addView(textRow(if (s > 0) "Season $s" else "Specials", s == now?.season).apply {
                    setOnFocusChangeListener { v, has -> paint(v, has); if (has) show(s, false) }
                    setOnClickListener { show(s, true) }
                })
            }
            row.addView(ScrollView(context).apply { isVerticalScrollBarEnabled = false; addView(seasonList) },
                LinearLayout.LayoutParams(dp(220), ViewGroup.LayoutParams.MATCH_PARENT))
        }
        row.addView(scroll, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        dim.addView(row, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(dim)
        panel = dim
        show(now?.season ?: seasons.first(), true)
    }

    fun closeEpisodes() {
        panel?.let { root.removeView(it) }
        panel = null
    }

    private fun episodeRow(e: Episode): View {
        val playing = e.id == current
        val box = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(10), dp(16), dp(10)); isFocusable = true; isFocusableInTouchMode = true
            background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(0) }
        }
        val thumb = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { cornerRadius = dp(6).toFloat(); setColor(0xFF1E1E22.toInt()) }
            clipToOutline = true
        }
        load(e.thumb, thumb)
        box.addView(thumb, LinearLayout.LayoutParams(dp(176), dp(99)).apply { marginEnd = dp(18) })
        val text = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val title = TextView(context).apply {
            this.text = "${e.episode}. ${e.title.ifEmpty { e.label }}"; textSize = 20f; setTextColor(0xFFFFFFFF.toInt())
            setTypeface(typeface, Typeface.BOLD); maxLines = 2; ellipsize = TextUtils.TruncateAt.END
        }
        val note = TextView(context).apply {
            this.text = when { playing -> "Now playing"; e.watched -> "Watched"; else -> e.label }
            textSize = 15f; setTextColor(if (playing) 0xFFE50914.toInt() else 0x99FFFFFF.toInt()); setPadding(0, dp(4), 0, 0)
        }
        text.addView(title); text.addView(note)
        box.addView(text, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        box.setOnFocusChangeListener { v, has ->
            (v.background as GradientDrawable).setColor(if (has) 0xFFFFFFFF.toInt() else 0)
            title.setTextColor(if (has) 0xFF000000.toInt() else 0xFFFFFFFF.toInt())
            note.setTextColor(if (has) 0x99000000.toInt() else if (playing) 0xFFE50914.toInt() else 0x99FFFFFF.toInt())
        }
        box.setOnClickListener { if (playing) closeEpisodes() else choose("episode:${e.id}") }
        return box
    }

    // ---- Up Next ----------------------------------------------------------------------------------

    private var card: View? = null
    private var countdown: TextView? = null
    private var cardPlay: View? = null
    private var cardFocused = false
    private var dismissed = false
    private var held = false

    /** A panel is open over the picture: Up Next steps aside meanwhile (and comes back after) */
    fun hold(on: Boolean) { held = on; if (on) hideCard() }

    /** Called as playback goes: Up Next shows for the last [notifyMs] (Stremio's own setting) */
    fun tick(positionMs: Long, durationMs: Long, controlsBusy: Boolean) {
        val n = next ?: return
        if (held) { hideCard(); return }
        val remaining = durationMs - positionMs
        if (dismissed || durationMs <= 0 || remaining > notifyMs || remaining <= 0) {
            if (remaining > notifyMs) dismissed = false
            hideCard(); return
        }
        if (card == null) showCard(n)
        // the remote goes to Play now as soon as nothing else is using it (the controls, a panel)
        if (!controlsBusy && !cardFocused) cardPlay?.let { cardFocused = it.requestFocus() }
        countdown?.text = if (binge) "Starts in ${(remaining / 1000).coerceAtLeast(1)} s" else "When this one ends"
    }

    /** At the end: on to the next episode when binge-watching is on (and Up Next wasn't put away) */
    fun onEnded(): Boolean {
        if (next == null || !binge || dismissed) return false
        choose("next"); return true
    }

    /** Back with Up Next showing puts it away (the credits play on) */
    fun dismissCard(): Boolean {
        if (card == null) return false
        dismissed = true; hideCard(); return true
    }

    val cardShowing get() = card != null

    private fun showCard(n: Episode) {
        val box = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(14), dp(14), dp(18), dp(14))
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(0xF0141414.toInt()) }
        }
        val thumb = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true
            background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(0xFF1E1E22.toInt()) }
        }
        load(n.thumb, thumb)
        box.addView(thumb, LinearLayout.LayoutParams(dp(208), dp(117)).apply { marginEnd = dp(18) })
        val info = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        info.addView(TextView(context).apply { text = "Next episode"; textSize = 14f; setTextColor(0x99FFFFFF.toInt()) })
        info.addView(TextView(context).apply {
            text = "${n.label} · ${n.title}".trimEnd(' ', '·'); textSize = 19f; setTextColor(0xFFFFFFFF.toInt())
            setTypeface(typeface, Typeface.BOLD); maxLines = 2; ellipsize = TextUtils.TruncateAt.END; setPadding(0, dp(2), 0, dp(10))
        })
        val play = TextView(context).apply {
            text = "▶  Play now"; textSize = 17f; setTypeface(typeface, Typeface.BOLD); setPadding(dp(18), dp(9), dp(18), dp(9))
            isFocusable = true; isFocusableInTouchMode = true
            background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(0x33FFFFFF) }
            setTextColor(0xFFFFFFFF.toInt())
            setOnFocusChangeListener { v, has -> paint(v, has) }
            setOnClickListener { choose("next") }
        }
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        actions.addView(play)
        countdown = TextView(context).apply { textSize = 15f; setTextColor(0x99FFFFFF.toInt()); setPadding(dp(14), 0, 0, 0) }
        actions.addView(countdown)
        info.addView(actions)
        box.addView(info, LinearLayout.LayoutParams(dp(330), ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, dp(48), dp(110)) })
        card = box
        cardPlay = play; cardFocused = false
    }

    private fun hideCard() {
        card?.let { root.removeView(it) }
        card = null; countdown = null; cardPlay = null
    }

    // ---- the player's bottom row ------------------------------------------------------------------

    /** Episodes and Next Episode, at the start of the player's bottom row; returns them for focus wiring */
    fun addButtons(bar: ViewGroup, openPanel: () -> Unit): List<View> {
        val out = mutableListOf<View>()
        if (next != null) out += button(R.drawable.ic_next_episode, "Next episode") { choose("next") }
        if (hasEpisodes) out += button(R.drawable.ic_episodes, "Episodes") { openPanel() }
        out.asReversed().forEach { bar.addView(it, 0) }
        return out
    }

    private fun button(icon: Int, label: String, act: () -> Unit) = ImageButton(context).apply {
        setImageResource(icon); contentDescription = label
        androidx.appcompat.widget.TooltipCompat.setTooltipText(this, label)
        setBackgroundResource(R.drawable.control_focus)
        val pad = dp(14); setPadding(pad, pad, pad, pad)
        layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
        isFocusable = true
        setOnClickListener { act() }
    }

    // ---- bits -------------------------------------------------------------------------------------

    private fun heading(text: String) = TextView(context).apply {
        this.text = text; textSize = 24f; setTypeface(typeface, Typeface.BOLD); setTextColor(0xFFFFFFFF.toInt()); setPadding(dp(12), dp(8), 0, dp(14))
    }

    private fun textRow(text: String, on: Boolean) = TextView(context).apply {
        this.text = text; textSize = 19f; setPadding(dp(16), dp(12), dp(16), dp(12))
        setTypeface(typeface, if (on) Typeface.BOLD else Typeface.NORMAL)
        setTextColor(0xFFFFFFFF.toInt()); isFocusable = true; isFocusableInTouchMode = true
        background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(0) }
    }

    private fun paint(v: View, has: Boolean) {
        (v.background as GradientDrawable).setColor(if (has) 0xFFFFFFFF.toInt() else if (v is TextView && v.text.startsWith("▶")) 0x33FFFFFF else 0)
        (v as? TextView)?.setTextColor(if (has) 0xFF000000.toInt() else 0xFFFFFFFF.toInt())
    }

    private fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()

    private fun load(url: String, into: ImageView) {
        if (!url.startsWith("https://")) return
        thumbs.get(url)?.let { into.setImageBitmap(it); return }
        into.tag = url
        io.execute {
            val bitmap = try {
                http.newCall(Request.Builder().url(url).build()).execute().use { r ->
                    val bytes = r.body?.bytes()?.takeIf { r.isSuccessful } ?: return@use null
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outWidth / (sample * 2) >= 400) sample *= 2
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                }
            } catch (_: Exception) { null } ?: return@execute
            thumbs.put(url, bitmap)
            main.post { if (into.tag == url) into.setImageBitmap(bitmap) }
        }
    }

    companion object {
        private val http = OkHttpClient.Builder().callTimeout(8, TimeUnit.SECONDS).build()
        private val io = Executors.newFixedThreadPool(3)
        private val main = Handler(Looper.getMainLooper())
        private val thumbs = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
            override fun sizeOf(key: String, value: Bitmap) = value.byteCount
        }
    }
}
