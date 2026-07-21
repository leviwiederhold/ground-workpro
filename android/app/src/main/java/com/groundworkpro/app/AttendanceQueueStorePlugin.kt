package com.groundworkpro.app

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

// Durable storage for the offline attendance queue (Android).
//
// STATUS: REFERENCE IMPLEMENTATION — NOT YET WIRED INTO THE BUILD OR VERIFIED ON
// A PHYSICAL DEVICE. See docs/attendance-offline-sync.md. Until the plugin is
// registered and exercised on a real phone, the JS layer falls back to
// localStorage and offline durability across a device restart is NOT proven.
//
// Why not localStorage: the app is a remote-URL Capacitor shell, so the queue
// would live in WebView web storage — wiped by "clear cache" and evictable
// under storage pressure.
//
// The queue holds no secrets (the attendance credential lives in the Keystore
// via SecureAttendanceStore), so this is app-private INTERNAL storage for
// durability, not encrypted storage for secrecy. Internal storage is not
// world-readable, is excluded from ordinary backups by the shared
// GeofenceBroadcastReceiver's configuration, and is removed with the app.

@CapacitorPlugin(name = "AttendanceQueueStore")
class AttendanceQueueStorePlugin : Plugin() {
    companion object {
        const val FILE_NAME = "attendance-queue.json"

        // Shared with GeofenceBroadcastReceiver, which appends to the same queue
        // when a background transition cannot be POSTed immediately.
        fun queueFile(context: android.content.Context): File =
            File(context.filesDir, FILE_NAME)
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val result = JSObject()
        val file = queueFile(context)
        result.put(
            "value",
            try {
                if (file.exists()) file.readText() else null
            } catch (e: Exception) {
                // A read failure must not break attendance: the JS layer falls
                // back to its localStorage mirror.
                null
            }
        )
        call.resolve(result)
    }

    @PluginMethod
    fun save(call: PluginCall) {
        val value = call.getString("value")
        if (value == null) {
            call.reject("value required")
            return
        }
        try {
            // Write-then-rename so a kill mid-write cannot leave a truncated
            // queue behind.
            val target = queueFile(context)
            val temp = File(context.filesDir, "$FILE_NAME.tmp")
            temp.writeText(value)
            if (!temp.renameTo(target)) {
                target.writeText(value)
                temp.delete()
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to persist attendance queue: ${e.message}")
        }
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        try {
            val file = queueFile(context)
            if (file.exists()) file.delete()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to clear attendance queue: ${e.message}")
        }
    }
}
