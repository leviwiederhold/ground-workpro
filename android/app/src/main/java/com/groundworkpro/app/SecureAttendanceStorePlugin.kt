package com.groundworkpro.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Secure storage for the device attendance credential (Android Keystore).
//
// The credential is a bearer token that authenticates background attendance
// submissions. It is encrypted with an AES-256-GCM key that lives in the
// Android Keystore — hardware-backed where the device supports it. The key
// never leaves the Keystore and the ciphertext is useless on another device.
//
// Why not EncryptedSharedPreferences: androidx.security:security-crypto is
// deprecated and unmaintained. Using the Keystore directly is ~60 lines, drops
// an abandoned dependency from the credential path, and gives explicit control
// over the one property that matters here — see below.
//
// setUserAuthenticationRequired is deliberately NOT set: the geofence receiver
// must decrypt this while the phone is in someone's pocket, after a background
// wake. Requiring an unlock would mean every arrival that happened on a locked
// phone failed to authenticate. Keystore keys are already unavailable before
// the first unlock after boot, which is the protection that actually applies.
//
// Until this existed, enrollDeviceCredential() correctly refused to mint a
// token — it will not create a credential it cannot store securely — so
// background submission had no way to authenticate at all.
@CapacitorPlugin(name = "SecureAttendanceStore")
class SecureAttendanceStorePlugin : Plugin() {

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "gw_attendance_credential_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val IV_BYTES = 12

        // The ciphertext itself is safe in ordinary preferences — it is
        // unreadable without the Keystore key.
        private const val PREFS_NAME = "gw_attendance_secure"
        private const val TOKEN_KEY = "attendance_token"
        private const val EXPIRES_KEY = "attendance_token_expires_at"

        private fun prefs(context: Context) =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        private fun secretKey(): SecretKey? = try {
            val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            val existing = (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            existing ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
                init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build()
                )
                generateKey()
            }
        } catch (e: Exception) {
            // No usable Keystore. Returning null rather than falling back to
            // plaintext is deliberate: a credential we cannot protect must not
            // be stored at all, and the enrollment path already treats "no
            // secure store" as "do not mint a token".
            null
        }

        private fun encrypt(plaintext: String): String? {
            return try {
                val key = secretKey() ?: return null
                val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }
                val iv = cipher.iv
                // iv || ciphertext — the IV is not secret and must be stored with it.
                Base64.encodeToString(iv + cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
            } catch (e: Exception) {
                null
            }
        }

        private fun decrypt(encoded: String): String? {
            return try {
                val key = secretKey() ?: return null
                val bytes = Base64.decode(encoded, Base64.NO_WRAP)
                if (bytes.size <= IV_BYTES) return null
                val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                    init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, bytes, 0, IV_BYTES))
                }
                String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
            } catch (e: Exception) {
                // Includes the case where the key was invalidated (app reinstall,
                // some backup restores). The credential is simply gone; the app
                // re-enrolls on next launch.
                null
            }
        }

        /** The stored token, or null. Safe to call from the geofence receiver. */
        fun loadToken(context: Context): String? =
            prefs(context).getString(TOKEN_KEY, null)
                ?.takeIf { it.isNotEmpty() }
                ?.let { decrypt(it) }
                ?.takeIf { it.isNotEmpty() }

        fun hasCredential(context: Context): Boolean = loadToken(context) != null

        fun save(context: Context, token: String, expiresAt: String): Boolean {
            val encrypted = encrypt(token) ?: return false
            return prefs(context).edit()
                .putString(TOKEN_KEY, encrypted)
                .putString(EXPIRES_KEY, expiresAt)
                .commit()
        }

        fun expiresAt(context: Context): String = prefs(context).getString(EXPIRES_KEY, "") ?: ""

        fun clearToken(context: Context) {
            prefs(context).edit().clear().apply()
            try {
                KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(KEY_ALIAS)
            } catch (e: Exception) {
                // The preferences are already cleared; an orphaned key is inert.
            }
        }
    }

    @PluginMethod
    fun setToken(call: PluginCall) {
        val token = call.getString("token")
        if (token.isNullOrEmpty()) {
            call.reject("token required")
            return
        }
        if (save(context, token, call.getString("expiresAt") ?: "")) {
            call.resolve()
        } else {
            call.reject("Failed to store the attendance credential in the Keystore")
        }
    }

    /**
     * Reports only WHETHER a credential exists and when it expires — never the
     * token itself. The web layer has no reason to hold the plaintext, and the
     * whole point of the Keystore is that it does not leave it.
     */
    @PluginMethod
    fun getToken(call: PluginCall) {
        val result = JSObject()
        result.put("hasToken", hasCredential(context))
        result.put("expiresAt", expiresAt(context))
        call.resolve(result)
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        clearToken(context)
        call.resolve()
    }
}
