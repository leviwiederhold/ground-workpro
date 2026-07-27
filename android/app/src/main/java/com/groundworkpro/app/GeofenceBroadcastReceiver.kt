package com.groundworkpro.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.preference.PreferenceManager
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Receives geofence transitions even when the app is not running, and records a
// single discrete event per transition.
//
// Delivery is deliberately two-tiered:
//   1. try to POST immediately, and
//   2. on ANY failure, append to the shared offline queue.
// The queue is the same file the JS layer flushes, so a transition detected with
// no signal is not lost — it syncs later with its ORIGINAL timestamp, and the
// server's idempotency guards collapse any overlap into one record.
//
// goAsync() is what makes that safe: a BroadcastReceiver is killed the moment
// onReceive returns, so the previous fire-and-forget thread was liable to be
// terminated mid-request with the event neither sent nor queued.
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)

        if (event.hasError()) {
            prefs.edit().putString("gw_last_error", "Geofence error ${event.errorCode}").apply()
            return
        }

        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return
        }

        val triggering = event.triggeringGeofences ?: return
        if (triggering.isEmpty()) return

        val occurredAt = AttendanceNativeQueue.isoNow()
        prefs.edit()
            .putString("gw_last_event_at", occurredAt)
            .putString("gw_last_event_transition", transition)
            .apply()

        val baseUrl = (prefs.getString("gw_server_base_url", "") ?: "").trimEnd('/')
        val token = SecureAttendanceStorePlugin.loadToken(context)
        val deviceId = prefs.getString("gw_device_id", null)
        val appContext = context.applicationContext

        // Keep the process alive past onReceive so the request can finish.
        val pending = goAsync()
        Thread {
            try {
                for (geofence in triggering) {
                    val parts = geofence.requestId.split(":")
                    if (parts.size != 2) continue
                    submitOrQueue(
                        context = appContext,
                        baseUrl = baseUrl,
                        token = token,
                        jobId = parts[0],
                        zone = parts[1],
                        transition = transition,
                        occurredAt = occurredAt,
                        deviceId = deviceId
                    )
                }
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun submitOrQueue(
        context: Context,
        baseUrl: String,
        token: String?,
        jobId: String,
        zone: String,
        transition: String,
        occurredAt: String,
        deviceId: String?
    ) {
        fun queue(reason: String) {
            PreferenceManager.getDefaultSharedPreferences(context).edit()
                .putString("gw_last_error", reason).apply()
            AttendanceNativeQueue.enqueue(context, jobId, zone, transition, occurredAt, deviceId)
        }

        if (baseUrl.isEmpty()) {
            queue("No server URL configured")
            return
        }
        if (token.isNullOrEmpty()) {
            // No credential yet. The event is still real — queue it so it syncs
            // once the app enrolls, rather than discarding attendance.
            queue("No attendance credential")
            return
        }

        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$baseUrl/api/jobsite-time/events").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                doOutput = true
            }
            val body = JSONObject()
                .put("jobId", jobId)
                .put("zone", zone)
                .put("transition", transition)
                .put("occurredAt", occurredAt)
                .put("source", "jobsite_auto")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }

            val status = conn.responseCode
            if (status !in 200..299) {
                // Includes 401 (credential expired) and 5xx — the JS queue
                // classifies and retries these with backoff.
                queue("HTTP $status")
            } else {
                PreferenceManager.getDefaultSharedPreferences(context).edit()
                    .putString("gw_last_error", "").apply()
            }
        } catch (e: Exception) {
            queue(e.message ?: "network error")
        } finally {
            conn?.disconnect()
        }
    }
}
