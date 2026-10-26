package com.notdxbi.dxbi.tv

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-encrypted values. Every instance shares one file, so the key and the decrypted values are
 * kept in memory for the process: page-side reads (plugin settings, identity checks) go through the
 * synchronous JS bridge, and a keystore round trip on each one stalls the page.
 */
class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("household-vault", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        cachedKey?.let { return it }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = (store.getKey("household-session", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("household-session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
        cachedKey = key
        return key
    }
    fun put(name: String, value: String?) = synchronized(lock) {
        if (value == null) { prefs.edit().remove(name).commit(); plain.remove(name); return@synchronized }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        prefs.edit().putString(name, Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)).commit()
        plain[name] = value
    }
    fun get(name: String): String? = synchronized(lock) {
        plain[name]?.let { return@synchronized it }
        try {
            prefs.getString(name, null)?.let { value ->
                val bytes = Base64.decode(value, Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
                String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8).also { plain[name] = it }
            }
        } catch (_: Exception) { null }
    }
    fun removePrefix(prefix:String) = synchronized(lock) {val editor=prefs.edit();prefs.all.keys.filter {it.startsWith(prefix)}.forEach {editor.remove(it)};editor.commit();plain.keys.removeAll {it.startsWith(prefix)}}
    fun contains(name:String)=prefs.contains(name)
    companion object {
        private val lock = Any()
        @Volatile private var cachedKey: SecretKey? = null
        private val plain = HashMap<String, String>()
    }
}
