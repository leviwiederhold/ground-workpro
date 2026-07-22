package com.groundworkpro.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
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
}
