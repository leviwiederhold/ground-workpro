package com.groundworkpro.app;

import android.os.Bundle;

import androidx.preference.PreferenceManager;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

import java.net.URI;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The BroadcastReceiver can run without this Activity or any WebView.
        // Persist the exact synced server origin before Capacitor starts so a
        // terminated/background geofence event knows where to deliver.
        configureAttendanceBackgroundContext();

        // Registration MUST happen before super.onCreate(), which is where
        // Capacitor builds the bridge and freezes the plugin registry.
        // Without these three lines the classes compile, ship, and are never
        // registered — Capacitor.Plugins.JobsiteGeofence stays undefined and
        // every native path silently falls back to the web implementation.
        // That was the actual state of this app before PR 17.
        registerPlugin(JobsiteGeofencePlugin.class);
        registerPlugin(AttendanceQueueStorePlugin.class);
        registerPlugin(SecureAttendanceStorePlugin.class);
        super.onCreate(savedInstanceState);
    }

    private void configureAttendanceBackgroundContext() {
        var preferences = PreferenceManager.getDefaultSharedPreferences(this);
        var editor = preferences.edit();

        try {
            String configuredUrl = CapConfig.loadDefault(this).getServerUrl();
            URI parsed = configuredUrl == null ? null : URI.create(configuredUrl);
            if (parsed != null && parsed.getScheme() != null && parsed.getRawAuthority() != null) {
                editor.putString(
                    "gw_server_base_url",
                    parsed.getScheme() + "://" + parsed.getRawAuthority()
                );
            } else {
                editor.remove("gw_server_base_url");
            }
        } catch (Exception ignored) {
            // Never let a malformed bundled config crash launch. The receiver
            // will durably queue an event instead of sending it to a guessed
            // origin.
            editor.remove("gw_server_base_url");
        }

        if ((preferences.getString("gw_device_id", "") == null) ||
            preferences.getString("gw_device_id", "").isEmpty()) {
            editor.putString("gw_device_id", UUID.randomUUID().toString());
        }
        editor.apply();
    }
}
