package com.groundworkpro.app

import android.app.PendingIntent
import android.content.Intent
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
// STATUS: REFERENCE IMPLEMENTATION — NOT YET WIRED INTO THE BUILD OR VERIFIED ON
// A PHYSICAL DEVICE. See docs/attendance-native-geofencing.md for the remaining
// steps (add play-services-location, register the plugin + the
// GeofenceBroadcastReceiver in the manifest, request ACCESS_BACKGROUND_LOCATION,
// supply the background-auth token, and verify arrival/departure on a real
// device while the app is backgrounded/terminated). Until then, automatic
// background attendance is NOT complete.
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
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    @PluginMethod
    fun register(call: PluginCall) {
        val regions = call.getArray("regions") ?: run {
            call.reject("regions required")
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
        if (geofences.isEmpty()) {
            call.resolve()
            return
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build()

        // Requires ACCESS_FINE_LOCATION + ACCESS_BACKGROUND_LOCATION already granted.
        geofencingClient.addGeofences(request, geofencePendingIntent())
            .addOnSuccessListener { call.resolve() }
            .addOnFailureListener { e -> call.reject(e.message ?: "addGeofences failed") }
    }

    @PluginMethod
    fun removeAll(call: PluginCall) {
        geofencingClient.removeGeofences(geofencePendingIntent())
            .addOnSuccessListener { call.resolve() }
            .addOnFailureListener { e -> call.reject(e.message ?: "removeGeofences failed") }
    }

    @PluginMethod
    fun getRegistered(call: PluginCall) {
        // The platform API does not expose the registered set; the app mirrors it
        // in Preferences when registering. Returning empty is acceptable for the
        // diagnostics view (which also relies on the last-known registration).
        call.resolve()
    }
}
