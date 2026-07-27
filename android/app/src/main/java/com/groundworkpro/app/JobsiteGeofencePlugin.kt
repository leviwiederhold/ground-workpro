package com.groundworkpro.app

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

// Native jobsite geofencing for automatic attendance (Android).
//
// Why native: the app is a remote-URL Capacitor shell, so no WebView JS runs
// while backgrounded/closed. The platform Geofencing API delivers enter/exit
// transitions to a BroadcastReceiver even when the app is not running; that
// receiver POSTs a single discrete event to /api/jobsite-time/events.

@CapacitorPlugin(name = "JobsiteGeofence")
class JobsiteGeofencePlugin : Plugin() {
    private lateinit var geofencingClient: GeofencingClient

    override fun load() {
        geofencingClient = LocationServices.getGeofencingClient(context)
    }

    private fun geofencePendingIntent(): PendingIntent {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        // FLAG_MUTABLE only exists from API 31. The geofencing API fills the
        // transition details into this intent, so it MUST stay mutable on the
        // versions that have the flag — passing FLAG_IMMUTABLE would silently
        // deliver empty events.
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    private fun hasBackgroundLocation(): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        // ACCESS_BACKGROUND_LOCATION is only a separate grant from API 29.
        val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        return fine && background
    }

    @PluginMethod
    fun register(call: PluginCall) {
        val regions = call.getArray("regions") ?: run {
            call.reject("regions required")
            return
        }
        // addGeofences() throws SecurityException without these. Failing with a
        // clear message beats a crash in a background callback later.
        if (!hasBackgroundLocation()) {
            call.reject("Background location permission is required for automatic attendance")
            return
        }
        val geofences = ArrayList<Geofence>()
        for (i in 0 until regions.length()) {
            val region = regions.getJSONObject(i)
            geofences.add(
                Geofence.Builder()
                    .setRequestId(region.getString("identifier"))
                    .setCircularRegion(
                        region.getDouble("latitude"),
                        region.getDouble("longitude"),
                        region.getDouble("radiusMeters").toFloat()
                    )
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                    .build()
            )
        }
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        if (geofences.isEmpty()) {
            // An empty set is the instruction to DEREGISTER — that is how
            // monitoring stops for a resolved workday.
            geofencingClient.removeGeofences(geofencePendingIntent())
            prefs.edit().putInt("gw_registered_count", 0).putString("gw_registered_regions", "[]").apply()
            call.resolve()
            return
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build()

        // Requires ACCESS_FINE_LOCATION + ACCESS_BACKGROUND_LOCATION already granted.
        // Replace the whole set: the caller owns the desired state, and a stale
        // region left registered would re-trigger arrivals for a finished
        // assignment.
        geofencingClient.removeGeofences(geofencePendingIntent()).addOnCompleteListener {
            try {
                geofencingClient.addGeofences(request, geofencePendingIntent())
                    .addOnSuccessListener {
                        // The platform API cannot be queried for the registered
                        // set, so mirror it — this is what getRegistered() and
                        // the diagnostics panel read back.
                        prefs.edit()
                            .putInt("gw_registered_count", geofences.size)
                            .putString("gw_registered_regions", regions.toString())
                            .putString("gw_last_error", "")
                            .apply()
                        val result = JSObject()
                        result.put("registered", geofences.size)
                        call.resolve(result)
                    }
                    .addOnFailureListener { e ->
                        prefs.edit().putString("gw_last_error", e.message ?: "addGeofences failed").apply()
                        call.reject(e.message ?: "addGeofences failed")
                    }
            } catch (e: SecurityException) {
                call.reject("Location permission was revoked: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun removeAll(call: PluginCall) {
        geofencingClient.removeGeofences(geofencePendingIntent())
            .addOnSuccessListener {
                PreferenceManager.getDefaultSharedPreferences(context).edit()
                    .putInt("gw_registered_count", 0)
                    .putString("gw_registered_regions", "[]")
                    .apply()
                call.resolve()
            }
            .addOnFailureListener { e -> call.reject(e.message ?: "removeGeofences failed") }
    }

    @PluginMethod
    fun getRegistered(call: PluginCall) {
        // The platform API does not expose the registered set, so this returns
        // the mirror written at registration time. Documented as a mirror
        // rather than an OS read — on iOS the same call IS an OS read.
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val raw = prefs.getString("gw_registered_regions", "[]") ?: "[]"
        val result = JSObject()
        result.put("regions", try { JSArray(raw) } catch (e: Exception) { JSArray() })
        call.resolve(result)
    }

    // Health/registration status surfaced to the web layer + diagnostics.
    @PluginMethod
    fun getHealth(call: PluginCall) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val result = JSObject()
        result.put("supported", true)
        // The REAL permission state, read from the OS — not a flag we set and
        // hoped stayed true.
        result.put("authorized", hasBackgroundLocation())
        result.put("registeredCount", prefs.getInt("gw_registered_count", 0))
        result.put("lastEventAt", prefs.getString("gw_last_event_at", null))
        result.put("lastEventTransition", prefs.getString("gw_last_event_transition", null))
        result.put("lastError", prefs.getString("gw_last_error", null))
        // Real queue depth, read from the shared file.
        result.put("pendingQueuedCount", AttendanceNativeQueue.pendingCount(context))
        result.put("hasCredential", SecureAttendanceStorePlugin.hasCredential(context))
        call.resolve(result)
    }
}
