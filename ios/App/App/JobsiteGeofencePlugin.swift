import Foundation
import CoreLocation
import UIKit
import Capacitor

// Native jobsite geofencing for automatic attendance (iOS).
//
// Why native: the app is a remote-URL Capacitor shell, so no WebView JS runs
// while the app is backgrounded or closed. CoreLocation region monitoring wakes
// the app for enter/exit transitions even after termination; this class handles
// those transitions and records a single discrete event per transition (never a
// continuous stream).
//
// Delivery is deliberately two-tiered:
//   1. try to POST immediately, and
//   2. on ANY failure, append to the shared offline queue.
// The queue is the same file the JS layer flushes, so a transition detected with
// no signal is not lost — it syncs later with its ORIGINAL timestamp, and the
// server's idempotency guards collapse any overlap into one record.

@objc(JobsiteGeofencePlugin)
public class JobsiteGeofencePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    // Capacitor 6+ registers Swift plugins through CAPBridgedPlugin. Without
    // these three members the class compiles, ships, and is never registered —
    // `Capacitor.Plugins.JobsiteGeofence` stays undefined and every native path
    // silently falls back to the web implementation. That was the actual state
    // of this plugin before PR 17.
    public let identifier = "JobsiteGeofencePlugin"
    public let jsName = "JobsiteGeofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRegistered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getHealth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlwaysAuthorization", returnType: CAPPluginReturnPromise)
    ]

    private let manager = CLLocationManager()

    /// Where background events are POSTed. Written by AppDelegate at launch from
    /// the same resolved URL the WebView loads, so a preview build never posts
    /// to production.
    private var serverBaseUrl: String {
        UserDefaults.standard.string(forKey: "gw_server_base_url") ?? ""
    }

    override public func load() {
        manager.delegate = self
        manager.pausesLocationUpdatesAutomatically = false
        // Legal only because UIBackgroundModes includes `location` (see
        // Info.plist). Region monitoring alone would not require it, but the
        // wake-region → arrival-region handoff briefly requests updates, and
        // setting this without the background mode raises at runtime.
        if manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
    }

    // MARK: - Plugin surface

    // register({ regions: [{ identifier, jobId, zone, latitude, longitude, radiusMeters }] })
    @objc func register(_ call: CAPPluginCall) {
        guard let regions = call.getArray("regions", JSObject.self) else {
            call.reject("regions required")
            return
        }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            call.reject("Region monitoring is not available on this device")
            return
        }

        // Replace the whole set: the caller owns the desired state, and leaving
        // a stale region registered would re-trigger arrivals for a finished
        // assignment.
        for existing in manager.monitoredRegions {
            manager.stopMonitoring(for: existing)
        }

        var registered = 0
        for region in regions {
            guard
                let identifier = region["identifier"] as? String,
                let latitude = region["latitude"] as? Double,
                let longitude = region["longitude"] as? Double,
                let radius = region["radiusMeters"] as? Double
            else { continue }
            let clampedRadius = min(radius, manager.maximumRegionMonitoringDistance)
            let clRegion = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                radius: clampedRadius,
                identifier: identifier
            )
            clRegion.notifyOnEntry = true
            clRegion.notifyOnExit = true
            manager.startMonitoring(for: clRegion)
            registered += 1
        }

        UserDefaults.standard.set(registered, forKey: "gw_registered_count")
        call.resolve(["registered": registered])
    }

    @objc func removeAll(_ call: CAPPluginCall) {
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        UserDefaults.standard.set(0, forKey: "gw_registered_count")
        call.resolve()
    }

    @objc func getRegistered(_ call: CAPPluginCall) {
        // Read back from the OS, not from a mirror — this is what makes
        // "assigned job geofence registered" in diagnostics a real answer
        // rather than an echo of what we last asked for.
        let regions: [JSObject] = manager.monitoredRegions.compactMap { region in
            guard let circular = region as? CLCircularRegion else { return nil }
            let parts = circular.identifier.split(separator: ":")
            var obj = JSObject()
            obj["identifier"] = circular.identifier
            obj["jobId"] = parts.count == 2 ? String(parts[0]) : ""
            obj["zone"] = parts.count == 2 ? String(parts[1]) : ""
            obj["latitude"] = circular.center.latitude
            obj["longitude"] = circular.center.longitude
            obj["radiusMeters"] = circular.radius
            return obj
        }
        call.resolve(["regions": regions])
    }

    @objc func getHealth(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        // Instance property, not the deprecated class method: the class method
        // returns a stale value on iOS 14+.
        let authorized = manager.authorizationStatus == .authorizedAlways
        let authorizationStatus: String
        switch manager.authorizationStatus {
        case .notDetermined: authorizationStatus = "not_determined"
        case .restricted: authorizationStatus = "restricted"
        case .denied: authorizationStatus = "denied"
        case .authorizedWhenInUse: authorizationStatus = "authorized_when_in_use"
        case .authorizedAlways: authorizationStatus = "authorized_always"
        @unknown default: authorizationStatus = "unknown"
        }
        let preciseLocation: Bool
        if #available(iOS 14.0, *) {
            preciseLocation = manager.accuracyAuthorization == .fullAccuracy
        } else {
            preciseLocation = true
        }
        call.resolve([
            "supported": CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
            "authorized": authorized,
            "authorizationStatus": authorizationStatus,
            "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
            "preciseLocation": preciseLocation,
            "registeredCount": manager.monitoredRegions.count,
            "lastEventAt": defaults.string(forKey: "gw_last_event_at") ?? "",
            "lastEventTransition": defaults.string(forKey: "gw_last_event_transition") ?? "",
            "lastError": defaults.string(forKey: "gw_last_error") ?? "",
            // Real queue depth, read from the shared file.
            "pendingQueuedCount": AttendanceNativeQueue.pendingCount(),
            // Whether a credential exists to authenticate background posts. The
            // JS lifecycle derivation refuses to claim monitoring is active
            // without it.
            "hasCredential": SecureAttendanceStorePlugin.hasCredential()
        ])
    }

    @objc func requestAlwaysAuthorization(_ call: CAPPluginCall) {
        if manager.authorizationStatus != .authorizedAlways {
            manager.requestAlwaysAuthorization()
        }
        // The OS owns the prompt and may complete it after this bridge call.
        // JavaScript keeps the full-screen gate mounted and rechecks health on
        // foreground return before it can dismiss.
        call.resolve()
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        handleTransition(region: region, transition: "enter")
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        handleTransition(region: region, transition: "exit")
    }

    public func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        UserDefaults.standard.set(error.localizedDescription, forKey: "gw_last_error")
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
        notifyListeners("geofenceAuthorizationChanged", data: [
            "authorized": manager.authorizationStatus == .authorizedAlways
        ])
    }

    private func handleTransition(region: CLRegion, transition: String) {
        // identifier is `${jobId}:${zone}`.
        let parts = region.identifier.split(separator: ":")
        guard parts.count == 2 else { return }
        let jobId = String(parts[0])
        let zone = String(parts[1])
        let occurredAt = ISO8601DateFormatter.attendance.string(from: Date())

        let defaults = UserDefaults.standard
        defaults.set(occurredAt, forKey: "gw_last_event_at")
        defaults.set(transition, forKey: "gw_last_event_transition")

        // Notify the foreground JS listener when the app happens to be alive.
        // This is a nice-to-have; the POST below is the critical path and does
        // not depend on any JS running.
        notifyListeners("geofenceTransition", data: [
            "identifier": region.identifier,
            "jobId": jobId,
            "zone": zone,
            "transition": transition,
            "occurredAt": occurredAt
        ])

        JobsiteGeofencePlugin.submitOrQueue(
            jobId: jobId,
            zone: zone,
            transition: transition,
            occurredAt: occurredAt,
            baseUrl: serverBaseUrl
        )
    }

    // MARK: - Delivery

    /// POST the transition, and queue it on any failure.
    ///
    /// The previous implementation used `URLSessionConfiguration.background`
    /// with a `dataTask`, which is invalid — background sessions reject data
    /// tasks, so the request was never sent and nothing noticed. This uses an
    /// ordinary session wrapped in a UIApplication background task, which is
    /// the correct shape for a single short request from a woken app, and falls
    /// back to the durable queue when it cannot complete.
    static func submitOrQueue(
        jobId: String,
        zone: String,
        transition: String,
        occurredAt: String,
        baseUrl: String
    ) {
        let deviceId = UserDefaults.standard.string(forKey: "gw_device_id")

        func queue(_ reason: String) {
            UserDefaults.standard.set(reason, forKey: "gw_last_error")
            AttendanceNativeQueue.enqueue(
                jobId: jobId,
                zone: zone,
                transition: transition,
                occurredAt: occurredAt,
                latitude: nil,
                longitude: nil,
                accuracyMeters: nil,
                deviceId: deviceId
            )
        }

        guard !baseUrl.isEmpty, let url = URL(string: "\(baseUrl)/api/jobsite-time/events") else {
            queue("No server URL configured")
            return
        }
        guard let token = SecureAttendanceStorePlugin.loadToken() else {
            // No credential yet. The event is still real — queue it so it syncs
            // once the app enrolls, rather than discarding attendance.
            queue("No attendance credential")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "jobId": jobId,
            "zone": zone,
            "transition": transition,
            "occurredAt": occurredAt,
            "source": "jobsite_auto"
        ])

        // Keep the app alive long enough to finish the request after a region
        // wake, which otherwise gets seconds of runtime.
        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "attendance-event") {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }

        URLSession.shared.dataTask(with: request) { _, response, error in
            defer {
                if backgroundTask != .invalid {
                    UIApplication.shared.endBackgroundTask(backgroundTask)
                    backgroundTask = .invalid
                }
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if error != nil || !(200...299).contains(status) {
                // Includes 401 (credential expired) and 5xx — the JS queue
                // classifies and retries these with backoff.
                queue(error?.localizedDescription ?? "HTTP \(status)")
            } else {
                UserDefaults.standard.set("", forKey: "gw_last_error")
            }
        }.resume()
    }
}
