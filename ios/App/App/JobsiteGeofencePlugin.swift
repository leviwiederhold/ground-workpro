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

/// Process-wide owner of Core Location attendance regions.
///
/// AppDelegate starts this before any WebView exists, including a location
/// relaunch after iOS terminated the app. The previous delegate lived only on
/// the Capacitor plugin instance, so a terminated-app entry had nobody to
/// receive it while a later background exit (with the process still alive)
/// worked normally.
final class AttendanceGeofenceCoordinator: NSObject, CLLocationManagerDelegate {
    static let shared = AttendanceGeofenceCoordinator()

    let manager = CLLocationManager()
    var eventSink: ((JSObject) -> Void)?
    private var started = false
    private var initialStateRequests = Set<String>()

    func start() {
        if !started {
            manager.delegate = self
            manager.pausesLocationUpdatesAutomatically = false
            started = true
        }
        if manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
    }

    private func matches(_ existing: CLCircularRegion, _ desired: JSObject) -> Bool {
        guard
            let latitude = desired["latitude"] as? Double,
            let longitude = desired["longitude"] as? Double,
            let radius = desired["radiusMeters"] as? Double
        else { return false }
        let clampedRadius = min(radius, manager.maximumRegionMonitoringDistance)
        return abs(existing.center.latitude - latitude) < 0.000001 &&
            abs(existing.center.longitude - longitude) < 0.000001 &&
            abs(existing.radius - clampedRadius) < 0.5
    }

    /// Reconcile desired state without an empty-region gap.
    func reconcile(_ regions: [JSObject]) -> Int {
        start()
        let desiredById = Dictionary(
            uniqueKeysWithValues: regions.compactMap { region -> (String, JSObject)? in
                guard let identifier = region["identifier"] as? String else { return nil }
                return (identifier, region)
            }
        )
        let existingById = Dictionary(
            uniqueKeysWithValues: manager.monitoredRegions.compactMap { region -> (String, CLCircularRegion)? in
                guard let circular = region as? CLCircularRegion else { return nil }
                return (circular.identifier, circular)
            }
        )

        // Remove only stale or materially changed regions. Unchanged regions
        // remain continuously monitored across launches and focus events.
        for (identifier, existing) in existingById {
            guard let desired = desiredById[identifier], matches(existing, desired) else {
                manager.stopMonitoring(for: existing)
                continue
            }
        }

        for (identifier, region) in desiredById {
            if let existing = existingById[identifier], matches(existing, region) {
                continue
            }
            guard
                let latitude = region["latitude"] as? Double,
                let longitude = region["longitude"] as? Double,
                let radius = region["radiusMeters"] as? Double
            else { continue }
            let circular = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                radius: min(radius, manager.maximumRegionMonitoringDistance),
                identifier: identifier
            )
            circular.notifyOnEntry = true
            circular.notifyOnExit = true
            initialStateRequests.insert(identifier)
            manager.startMonitoring(for: circular)
        }

        UserDefaults.standard.set(desiredById.count, forKey: "gw_registered_count")
        return desiredById.count
    }

    func removeAll() {
        start()
        initialStateRequests.removeAll()
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        UserDefaults.standard.set(0, forKey: "gw_registered_count")
    }

    func registeredRegions() -> [JSObject] {
        start()
        return manager.monitoredRegions.compactMap { region in
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
    }

    func requestAlwaysAuthorization() {
        start()
        if manager.authorizationStatus != .authorizedAlways {
            manager.requestAlwaysAuthorization()
        }
    }

    func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
        // Core Location does not guarantee an enter callback when monitoring is
        // first installed while the device is already inside. Determine the
        // initial state only for a newly-added region; unchanged registrations
        // are never re-fired on an ordinary app launch.
        if initialStateRequests.contains(region.identifier) {
            manager.requestState(for: region)
        }
    }

    func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        guard initialStateRequests.remove(region.identifier) != nil else { return }
        if state == .inside {
            handleTransition(region: region, transition: "enter")
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        handleTransition(region: region, transition: "enter")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        handleTransition(region: region, transition: "exit")
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        if let identifier = region?.identifier {
            initialStateRequests.remove(identifier)
        }
        UserDefaults.standard.set(error.localizedDescription, forKey: "gw_last_error")
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
    }

    private func handleTransition(region: CLRegion, transition: String) {
        let parts = region.identifier.split(separator: ":")
        guard parts.count == 2 else { return }
        let jobId = String(parts[0])
        let zone = String(parts[1])
        let occurredAt = ISO8601DateFormatter.attendance.string(from: Date())
        let defaults = UserDefaults.standard
        defaults.set(occurredAt, forKey: "gw_last_event_at")
        defaults.set(transition, forKey: "gw_last_event_transition")

        var event = JSObject()
        event["identifier"] = region.identifier
        event["jobId"] = jobId
        event["zone"] = zone
        event["transition"] = transition
        event["occurredAt"] = occurredAt
        eventSink?(event)

        JobsiteGeofencePlugin.submitOrQueue(
            jobId: jobId,
            zone: zone,
            transition: transition,
            occurredAt: occurredAt,
            baseUrl: defaults.string(forKey: "gw_server_base_url") ?? ""
        )
    }
}

@objc(JobsiteGeofencePlugin)
public class JobsiteGeofencePlugin: CAPPlugin, CAPBridgedPlugin {
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

    private let coordinator = AttendanceGeofenceCoordinator.shared

    override public func load() {
        coordinator.start()
        coordinator.eventSink = { [weak self] event in
            self?.notifyListeners("geofenceTransition", data: event)
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

        let registered = coordinator.reconcile(regions)
        call.resolve(["registered": registered])
    }

    @objc func removeAll(_ call: CAPPluginCall) {
        coordinator.removeAll()
        call.resolve()
    }

    @objc func getRegistered(_ call: CAPPluginCall) {
        // Read back from the OS, not from a mirror — this is what makes
        // "assigned job geofence registered" in diagnostics a real answer
        // rather than an echo of what we last asked for.
        call.resolve(["regions": coordinator.registeredRegions()])
    }

    @objc func getHealth(_ call: CAPPluginCall) {
        coordinator.start()
        let manager = coordinator.manager
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
        coordinator.requestAlwaysAuthorization()
        // The OS owns the prompt and may complete it after this bridge call.
        // JavaScript keeps the full-screen gate mounted and rechecks health on
        // foreground return before it can dismiss.
        call.resolve()
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
