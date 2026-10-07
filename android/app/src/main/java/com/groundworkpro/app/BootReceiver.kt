package com.groundworkpro.app

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import org.json.JSONArray

// Re-registers jobsite geofences after a reboot.
//
// Android CLEARS all geofences when the device restarts. Without this, an
// employee who reboots their phone overnight has no monitoring the next morning
// and no way to know — the app would report "monitoring active" while the OS
// was watching nothing, which is exactly the class of silent failure the
// lifecycle work exists to prevent.
//
// The region set is replayed from the mirror JobsiteGeofencePlugin writes at
// registration time. The app re-registers anyway the next time it is opened;
// this is what covers the window before that happens.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val raw = prefs.getString("gw_registered_regions", "[]") ?: "[]"

        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!fine || !background) {
            prefs.edit().putString("gw_last_error", "Geofences not restored after boot: location permission missing").apply()
            return
        }

        val geofences = ArrayList<Geofence>()
        try {
            val regions = JSONArray(raw)
            for (i in 0 until regions.length()) {
                val region = regions.optJSONObject(i) ?: continue
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
        } catch (e: Exception) {
            prefs.edit().putString("gw_last_error", "Could not restore geofences after boot: ${e.message}").apply()
            return
        }
        if (geofences.isEmpty()) return

        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, GeofenceBroadcastReceiver::class.java),
            flags
        )

        val request = GeofencingRequest.Builder()
            // INITIAL_TRIGGER_ENTER matters here: if the employee rebooted while
            // already onsite, re-registering must fire an enter immediately
            // rather than waiting for them to leave and come back.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build()

        // Keep this receiver alive until Play Services has accepted or rejected
        // the restored region set. Returning immediately makes the callback a
        // best-effort race and can silently leave a rebooted device unmonitored.
        val pending = goAsync()
        try {
            LocationServices.getGeofencingClient(context)
                .addGeofences(request, pendingIntent)
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        prefs.edit()
                            .putInt("gw_registered_count", geofences.size)
                            .putString("gw_last_error", "")
                            .apply()
                    } else {
                        prefs.edit()
                            .putString("gw_last_error", "Boot re-registration failed: ${task.exception?.message}")
                            .apply()
                    }
                    pending.finish()
                }
        } catch (e: SecurityException) {
            prefs.edit().putString("gw_last_error", "Boot re-registration denied: ${e.message}").apply()
            pending.finish()
        } catch (e: Exception) {
            prefs.edit().putString("gw_last_error", "Boot re-registration failed: ${e.message}").apply()
            pending.finish()
        }
    }
}
