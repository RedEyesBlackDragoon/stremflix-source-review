package com.notdxbi.dxbi.tv

import android.content.Context
import android.content.pm.PackageManager

/** The player tells the main screen where it is, so Stremio keeps the watch progress. */
object PlaybackBus {
    interface Listener {
        fun onProgress(positionMs: Long, durationMs: Long, paused: Boolean)
        /** [then]: what the viewer chose to play next ("next", or "episode:<video id>"), or null */
        fun onClosed(positionMs: Long, durationMs: Long, ended: Boolean, error: String?, then: String?)
    }

    @Volatile
    var listener: Listener? = null
}

object BuildConfigVersion {
    fun name(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
    } catch (_: PackageManager.NameNotFoundException) {
        "0"
    }
}
