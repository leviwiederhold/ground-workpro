import Foundation
import CoreLocation
import Capacitor

// Native jobsite geofencing for automatic attendance (iOS).
//
// STATUS: REFERENCE IMPLEMENTATION — NOT YET WIRED INTO THE BUILD OR VERIFIED ON
// A PHYSICAL DEVICE. See docs/attendance-native-geofencing.md for the remaining
// steps (register the plugin in the Xcode project, add the background-location
// entitlement + Info.plist keys, supply the background-auth token, and verify
// arrival/departure on a real device while the app is backgrounded/terminated).
// Until that is done, automatic background attendance is NOT complete.
//
// Why native: the app is a remote-URL Capacitor shell, so no WebView JS runs
// while the app is backgrounded or closed. CoreLocation region monitoring wakes
// the app for enter/exit transitions even when terminated; this class handles
// those transitions and POSTs a single discrete event per transition to the
// existing /api/jobsite-time/events endpoint (never a continuous stream).

@objc(JobsiteGeofencePlugin)
public class JobsiteGeofencePlugin: CAPPlugin, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    // The deployed site base URL and an attendance auth token are provided by the
    // web layer via Capacitor calls / Preferences (see the docs). Region monitoring
    // must be able to POST without the WebView being alive.
    private var serverBaseUrl: String { UserDefaults.standard.string(forKey: "gw_server_base_url") ?? "" }
    private var authToken: String { UserDefaults.standard.string(forKey: "gw_attendance_token") ?? "" }

    override public func load() {
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
    }

    // register({ regions: [{ identifier, jobId, zone, latitude, longitude, radiusMeters }] })
    @objc func register(_ call: CAPPluginCall) {
        guard let regions = call.getArray("regions", JSObject.self) else {
            call.reject("regions required")
            return
        }
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
        }
        call.resolve()
    }

    @objc func removeAll(_ call: CAPPluginCall) {
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        call.resolve()
    }

    @objc func getRegistered(_ call: CAPPluginCall) {
        let regions: [JSObject] = manager.monitoredRegions.compactMap { region in
            guard let circular = region as? CLCircularRegion else { return nil }
            var obj = JSObject()
            obj["identifier"] = circular.identifier
            obj["latitude"] = circular.center.latitude
            obj["longitude"] = circular.center.longitude
            obj["radiusMeters"] = circular.radius
            return obj
        }
        call.resolve(["regions": regions])
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        handleTransition(region: region, transition: "enter")
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        handleTransition(region: region, transition: "exit")
    }

    private func handleTransition(region: CLRegion, transition: String) {
        // identifier is `${jobId}:${zone}`.
        let parts = region.identifier.split(separator: ":")
        guard parts.count == 2 else { return }
        let jobId = String(parts[0])
        let zone = String(parts[1])
        let occurredAt = ISO8601DateFormatter().string(from: Date())

        // Notify the foreground JS listener when the app is alive (nice-to-have).
        notifyListeners("geofenceTransition", data: [
            "identifier": region.identifier,
            "jobId": jobId,
            "zone": zone,
            "transition": transition,
            "occurredAt": occurredAt
        ])

        // The critical path: POST directly, so it works when JS is not running.
        postEvent(jobId: jobId, zone: zone, transition: transition, occurredAt: occurredAt)
    }

    private func postEvent(jobId: String, zone: String, transition: String, occurredAt: String) {
        guard !serverBaseUrl.isEmpty, let url = URL(string: "\(serverBaseUrl)/api/jobsite-time/events") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !authToken.isEmpty {
            // Attendance-scoped bearer token minted by the web app (see docs).
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        let body: [String: Any] = [
            "jobId": jobId,
            "zone": zone,
            "transition": transition,
            "occurredAt": occurredAt,
            "source": "jobsite_auto"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        // Background-safe: a background URLSession survives app suspension.
        let config = URLSessionConfiguration.background(withIdentifier: "com.groundworkpro.geofence")
        let session = URLSession(configuration: config)
        session.dataTask(with: request).resume()
    }
}
