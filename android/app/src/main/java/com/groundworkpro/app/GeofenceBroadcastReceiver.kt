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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread

// Receives geofence transitions even when the app is not running and POSTs a
// single discrete event per transition to /api/jobsite-time/events.
//
// STATUS: REFERENCE IMPLEMENTATION — NOT YET WIRED/VERIFIED. Must be declared in
// AndroidManifest.xml and the server base URL + attendance token supplied via
// Preferences by the web layer. See docs/attendance-native-geofencing.md.
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return

        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return
        }

        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val baseUrl = prefs.getString("gw_server_base_url", "") ?: ""
        val token = prefs.getString("gw_attendance_token", "") ?: ""
        if (baseUrl.isEmpty()) return

        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        for (geofence in event.triggeringGeofences ?: emptyList()) {
            val parts = geofence.requestId.split(":")
            if (parts.size != 2) continue
            val jobId = parts[0]
            val zone = parts[1]
            postEvent(baseUrl, token, jobId, zone, transition, iso)
        }
    }

    private fun postEvent(
        baseUrl: String,
        token: String,
        jobId: String,
        zone: String,
        transition: String,
        occurredAt: String
    ) {
        thread {
            try {
                val url = URL("$baseUrl/api/jobsite-time/events")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                if (token.isNotEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
                conn.doOutput = true
                val body = JSONObject()
                    .put("jobId", jobId)
                    .put("zone", zone)
                    .put("transition", transition)
                    .put("occurredAt", occurredAt)
                    .put("source", "jobsite_auto")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                conn.responseCode // fire the request
                conn.disconnect()
            } catch (_: Exception) {
                // Best-effort; a real build should retry via WorkManager.
            }
        }
    }
}
