import Foundation
import CoreLocation
import UIKit
import Capacitor

// Native jobsite geofencing for automatic attendance (iOS).
//
// Why native: the app is a remote-URL Capacitor shell, so no WebView JS runs
// while the app is backgrounded or closed. CoreLocation region monitoring can
// wake the app for enter/exit transitions after system termination; this class
// handles those transitions and records a single discrete event per transition
// (never a continuous stream). A user swipe-force-quit remains subject to iOS's
// system relaunch restrictions and cannot be overridden by application code.
//
// Delivery is deliberately write-ahead: append to the shared offline queue
// BEFORE the first HTTP attempt, then drain natively. The queue is the same file
// the JS layer can flush while open, but a Core Location wake does not need the
// WebView to retry it. The original transition timestamp is retained and the
// server's idempotency guards collapse any duplicate callback into one record.

/// Durable, non-secret lifecycle breadcrumbs.
///
/// A production build previously had no way to distinguish "Core Location
/// never woke the process" from "the callback fired but Keychain/network
/// failed." These records survive suspension/termination and are uploaded only
/// through the restricted device credential to a service-role-only table. They
/// are never rendered in the employee UI.
enum AttendanceNativeDiagnostics {
    private static let key = "gw_native_attendance_diagnostics"
    private static let ioQueue = DispatchQueue(label: "com.groundworkpro.attendance.diagnostics")
    private static let maximumRecords = 100

    @discardableResult
    static func record(
        code: String,
        stage: String,
        status: String,
        regionIdentifier: String? = nil,
        transition: String? = nil,
        details: [String: Any] = [:]
    ) -> String {
        ioQueue.sync {
            let id = UUID().uuidString
            var records = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
            var record: [String: Any] = [
                "id": id,
                "code": code,
                "stage": stage,
                "status": status,
                "occurredAt": ISO8601DateFormatter.attendance.string(from: Date()),
                "details": details
            ]
            if let regionIdentifier = regionIdentifier {
                record["regionIdentifier"] = regionIdentifier
            }
            if let transition = transition {
                record["transition"] = transition
            }
            records.append(record)
            if records.count > maximumRecords {
                records.removeFirst(records.count - maximumRecords)
            }
            UserDefaults.standard.set(records, forKey: key)
            return id
        }
    }

    static func pending() -> [[String: Any]] {
        ioQueue.sync {
            UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        }
    }

    static func remove(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        ioQueue.sync {
            let records = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
            UserDefaults.standard.set(
                records.filter { record in
                    guard let id = record["id"] as? String else { return false }
                    return !ids.contains(id)
                },
                forKey: key
            )
        }
    }
}

/// Access-token renewal that never touches Capacitor, cookies, or the WebView.
///
/// The refresh secret is separately scoped and Keychain-backed. It can only
/// rotate this device's attendance access token; revoking the device row makes
/// both secrets unusable immediately.
enum AttendanceNativeCredentialRefresher {
    private static let workQueue = DispatchQueue(label: "com.groundworkpro.attendance.credential")
    private static var inFlight = false
    private static var waiters: [(String?) -> Void] = []
    private static let refreshLeadTime: TimeInterval = 3 * 24 * 60 * 60

    static func accessToken(
        baseUrl: String,
        forceRefresh: Bool,
        completion: @escaping (String?) -> Void
    ) {
        workQueue.async {
            let current = SecureAttendanceStorePlugin.loadToken()
            let storedRefreshToken = SecureAttendanceStorePlugin.loadRefreshToken()
            let expiresAt = ISO8601DateFormatter.attendance.date(
                from: SecureAttendanceStorePlugin.accessExpiresAt()
            )
            if !forceRefresh,
               storedRefreshToken != nil,
               let current = current,
               let expiresAt = expiresAt,
               expiresAt.timeIntervalSinceNow > refreshLeadTime {
                completion(current)
                return
            }

            let legacyAccessToken = (expiresAt?.timeIntervalSinceNow ?? -1) > 0
                ? current
                : nil
            guard
                let authorizationToken = storedRefreshToken ?? legacyAccessToken,
                !baseUrl.isEmpty,
                let url = URL(string: "\(baseUrl)/api/attendance/device-credential/refresh")
            else {
                // Backward compatibility for a still-valid pre-refresh token.
                if !forceRefresh,
                   let current = current,
                   (expiresAt?.timeIntervalSinceNow ?? -1) > 0 {
                    completion(current)
                } else {
                    completion(nil)
                }
                return
            }

            waiters.append(completion)
            guard !inFlight else { return }
            inFlight = true
            AttendanceNativeDiagnostics.record(
                code: "credential_refresh",
                stage: "credential",
                status: "started"
            )

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("Bearer \(authorizationToken)", forHTTPHeaderField: "Authorization")
            URLSession.shared.dataTask(with: request) { data, response, error in
                workQueue.async {
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    var nextToken: String? = nil
                    if error == nil,
                       (200...299).contains(status),
                       let data = data,
                       let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let token = payload["token"] as? String,
                       let accessExpiry = payload["expiresAt"] as? String {
                        let saved: Bool
                        if let refreshToken = payload["refreshToken"] as? String,
                           let refreshExpiry = payload["refreshExpiresAt"] as? String {
                            saved = SecureAttendanceStorePlugin.saveCredential(
                                token: token,
                                expiresAt: accessExpiry,
                                refreshToken: refreshToken,
                                refreshExpiresAt: refreshExpiry
                            )
                        } else {
                            saved = SecureAttendanceStorePlugin.save(
                                token: token,
                                expiresAt: accessExpiry
                            )
                        }
                        guard saved else {
                            AttendanceNativeDiagnostics.record(
                                code: "credential_refresh",
                                stage: "credential",
                                status: "failed",
                                details: ["httpStatus": status, "reason": "Keychain write failed"]
                            )
                            let callbacks = waiters
                            waiters.removeAll()
                            inFlight = false
                            callbacks.forEach { $0(nil) }
                            return
                        }
                        if let deviceId = payload["deviceId"] as? String, !deviceId.isEmpty {
                            UserDefaults.standard.set(deviceId, forKey: "gw_device_id")
                        }
                        nextToken = token
                        AttendanceNativeDiagnostics.record(
                            code: "credential_refresh",
                            stage: "credential",
                            status: "succeeded",
                            details: ["httpStatus": status]
                        )
                    } else {
                        let reason = error?.localizedDescription ?? "HTTP \(status)"
                        AttendanceNativeDiagnostics.record(
                            code: "credential_refresh",
                            stage: "credential",
                            status: "failed",
                            details: ["httpStatus": status, "reason": reason]
                        )
                        UserDefaults.standard.set(reason, forKey: "gw_last_error")
                    }
                    let callbacks = waiters
                    waiters.removeAll()
                    inFlight = false
                    callbacks.forEach { $0(nextToken) }
                }
            }.resume()
        }
    }
}

/// Upload the last definitive native state and any unsent lifecycle breadcrumbs.
///
/// This path is entirely native and cookie-independent, so a Core Location
/// background relaunch updates CEO readiness without waiting for the WebView.
enum AttendanceNativeReadinessReporter {
    private static let workQueue = DispatchQueue(label: "com.groundworkpro.attendance.readiness")
    private static var inFlight = false

    static func submit(manager: CLLocationManager) {
        // CLLocationManager state belongs to the main thread. Capture a plain
        // JSON snapshot there, then perform all I/O on the private queue.
        let capture = {
            let defaults = UserDefaults.standard
            let authorization: String
            switch manager.authorizationStatus {
            case .notDetermined: authorization = "not_determined"
            case .restricted: authorization = "restricted"
            case .denied: authorization = "denied"
            case .authorizedWhenInUse: authorization = "authorized_when_in_use"
            case .authorizedAlways: authorization = "authorized_always"
            @unknown default: authorization = "unknown"
            }
            let precise: Bool
            if #available(iOS 14.0, *) {
                precise = manager.accuracyAuthorization == .fullAccuracy
            } else {
                precise = true
            }
            let required = defaults.stringArray(forKey: "gw_required_region_ids") ?? []
            let registered = manager.monitoredRegions.map(\.identifier).sorted()
            let readiness: [String: Any] = [
                "supported": CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
                "authorizationStatus": authorization,
                "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
                "backgroundRefreshEnabled": UIApplication.shared.backgroundRefreshStatus == .available,
                "preciseLocation": precise,
                "hasCredential": SecureAttendanceStorePlugin.hasCredential(),
                "requiredRegionIds": required.sorted(),
                "registeredRegionIds": registered,
                "reportedAt": ISO8601DateFormatter.attendance.string(from: Date())
            ]
            submitSnapshot(readiness)
        }
        if Thread.isMainThread {
            capture()
        } else {
            DispatchQueue.main.async(execute: capture)
        }
    }

    private static func submitSnapshot(_ readiness: [String: Any]) {
        workQueue.async {
            guard !inFlight else { return }
            inFlight = true

            let defaults = UserDefaults.standard
            let baseUrl = defaults.string(forKey: "gw_server_base_url") ?? ""
            guard
                !baseUrl.isEmpty,
                let url = URL(string: "\(baseUrl)/api/attendance/native-readiness"),
                let token = SecureAttendanceStorePlugin.loadToken()
            else {
                inFlight = false
                return
            }

            let diagnostics = AttendanceNativeDiagnostics.pending()
            let sentIds = Set(diagnostics.compactMap { $0["id"] as? String })
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try? JSONSerialization.data(withJSONObject: [
                "readiness": readiness,
                "diagnostics": diagnostics
            ])

            var backgroundTask: UIBackgroundTaskIdentifier = .invalid
            DispatchQueue.main.sync {
                backgroundTask = UIApplication.shared.beginBackgroundTask(
                    withName: "attendance-readiness"
                ) {
                    workQueue.async {
                        if backgroundTask != .invalid {
                            let task = backgroundTask
                            backgroundTask = .invalid
                            inFlight = false
                            DispatchQueue.main.async {
                                UIApplication.shared.endBackgroundTask(task)
                            }
                        }
                    }
                }
            }
            URLSession.shared.dataTask(with: request) { _, response, _ in
                workQueue.async {
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if (200...299).contains(status) {
                        AttendanceNativeDiagnostics.remove(ids: sentIds)
                    }
                    if backgroundTask != .invalid {
                        let task = backgroundTask
                        backgroundTask = .invalid
                        DispatchQueue.main.async {
                            UIApplication.shared.endBackgroundTask(task)
                        }
                    }
                    inFlight = false
                }
            }.resume()
        }
    }
}

/// Write-ahead, native-only attendance delivery.
///
/// Every callback is queued BEFORE network I/O. The native process drains that
/// queue on the callback and on every Core Location relaunch, so recovery never
/// depends on creating a Capacitor WebView.
enum AttendanceNativeDelivery {
    private static let workQueue = DispatchQueue(label: "com.groundworkpro.attendance.delivery")
    private static var draining = false

    static func enqueueAndDrain(
        jobId: String,
        zone: String,
        transition: String,
        occurredAt: String,
        latitude: Double? = nil,
        longitude: Double? = nil,
        accuracyMeters: Double? = nil
    ) {
        let deviceId = UserDefaults.standard.string(forKey: "gw_device_id")
        guard let eventId = AttendanceNativeQueue.enqueue(
            jobId: jobId,
            zone: zone,
            transition: transition,
            occurredAt: occurredAt,
            latitude: latitude,
            longitude: longitude,
            accuracyMeters: accuracyMeters,
            deviceId: deviceId
        ) else {
            AttendanceNativeDiagnostics.record(
                code: "queue_write",
                stage: "queue",
                status: "failed",
                transition: transition,
                details: ["reason": "attendance queue could not be persisted"]
            )
            UserDefaults.standard.set(
                "Attendance queue write failed",
                forKey: "gw_last_error"
            )
            return
        }
        AttendanceNativeDiagnostics.record(
            code: "queue_write",
            stage: "queue",
            status: "succeeded",
            transition: transition,
            details: ["eventId": eventId]
        )
        drain()
    }

    static func drain() {
        workQueue.async {
            guard !draining else { return }
            draining = true

            let defaults = UserDefaults.standard
            let baseUrl = defaults.string(forKey: "gw_server_base_url") ?? ""
            guard !baseUrl.isEmpty, URL(string: "\(baseUrl)/api/jobsite-time/events") != nil else {
                AttendanceNativeDiagnostics.record(
                    code: "server_url_missing",
                    stage: "http",
                    status: "failed"
                )
                draining = false
                return
            }
            let pending = AttendanceNativeQueue.pendingEvents()
            guard !pending.isEmpty else {
                draining = false
                AttendanceNativeReadinessReporter.submit(manager: AttendanceGeofenceCoordinator.shared.manager)
                return
            }

            var backgroundTask: UIBackgroundTaskIdentifier = .invalid
            DispatchQueue.main.sync {
                backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "attendance-queue-drain") {
                    workQueue.async {
                        AttendanceNativeDiagnostics.record(
                            code: "background_time_expired",
                            stage: "http",
                            status: "failed"
                        )
                        if backgroundTask != .invalid {
                            let task = backgroundTask
                            backgroundTask = .invalid
                            DispatchQueue.main.async {
                                UIApplication.shared.endBackgroundTask(task)
                            }
                        }
                        draining = false
                    }
                }
            }

            func finish() {
                if backgroundTask != .invalid {
                    let task = backgroundTask
                    backgroundTask = .invalid
                    DispatchQueue.main.async {
                        UIApplication.shared.endBackgroundTask(task)
                    }
                }
                draining = false
                AttendanceNativeReadinessReporter.submit(manager: AttendanceGeofenceCoordinator.shared.manager)
            }

            func send(_ index: Int, token: String, refreshedAfterUnauthorized: Bool) {
                guard index < pending.count else {
                    finish()
                    return
                }
                let event = pending[index]
                guard
                    let eventId = event["eventId"] as? String,
                    let jobId = event["jobId"] as? String,
                    let zone = event["zone"] as? String,
                    let transition = event["transition"] as? String,
                    let occurredAt = event["occurredAt"] as? String,
                    let url = URL(string: "\(baseUrl)/api/jobsite-time/events")
                else {
                    finish()
                    return
                }

                AttendanceNativeDiagnostics.record(
                    code: "http_attempt",
                    stage: "http",
                    status: "started",
                    transition: transition,
                    details: ["eventId": eventId]
                )
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.timeoutInterval = 20
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.httpBody = try? JSONSerialization.data(withJSONObject: [
                    "jobId": jobId,
                    "zone": zone,
                    "transition": transition,
                    "occurredAt": occurredAt,
                    "latitude": event["latitude"] ?? NSNull(),
                    "longitude": event["longitude"] ?? NSNull(),
                    "accuracyMeters": event["accuracyMeters"] ?? NSNull(),
                    "source": "jobsite_auto"
                ])

                URLSession.shared.dataTask(with: request) { _, response, error in
                    workQueue.async {
                        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                        if error == nil && (200...299).contains(status) {
                            AttendanceNativeQueue.markDelivered(eventId: eventId)
                            AttendanceNativeDiagnostics.record(
                                code: "http_result",
                                stage: "http",
                                status: "succeeded",
                                transition: transition,
                                details: ["eventId": eventId, "httpStatus": status]
                            )
                            UserDefaults.standard.set("", forKey: "gw_last_error")
                            send(index + 1, token: token, refreshedAfterUnauthorized: false)
                        } else if status == 401 && !refreshedAfterUnauthorized {
                            AttendanceNativeCredentialRefresher.accessToken(
                                baseUrl: baseUrl,
                                forceRefresh: true
                            ) { refreshedToken in
                                workQueue.async {
                                    if let refreshedToken = refreshedToken {
                                        send(
                                            index,
                                            token: refreshedToken,
                                            refreshedAfterUnauthorized: true
                                        )
                                    } else {
                                        AttendanceNativeQueue.markFailed(
                                            eventId: eventId,
                                            reason: "Attendance credential refresh failed"
                                        )
                                        finish()
                                    }
                                }
                            }
                        } else if (400...499).contains(status) &&
                                    status != 408 && status != 409 && status != 429 {
                            let reason = "HTTP \(status)"
                            AttendanceNativeQueue.markQuarantined(
                                eventId: eventId,
                                reason: reason
                            )
                            AttendanceNativeDiagnostics.record(
                                code: "http_result",
                                stage: "http",
                                status: "rejected",
                                transition: transition,
                                details: ["eventId": eventId, "httpStatus": status]
                            )
                            UserDefaults.standard.set(reason, forKey: "gw_last_error")
                            send(index + 1, token: token, refreshedAfterUnauthorized: false)
                        } else {
                            let reason = error?.localizedDescription ?? "HTTP \(status)"
                            AttendanceNativeQueue.markFailed(eventId: eventId, reason: reason)
                            AttendanceNativeDiagnostics.record(
                                code: "http_result",
                                stage: "http",
                                status: "failed",
                                transition: transition,
                                details: ["eventId": eventId, "httpStatus": status, "reason": reason]
                            )
                            UserDefaults.standard.set(reason, forKey: "gw_last_error")
                            // Preserve per-job ordering. A later exit/re-entry
                            // must not pass the failed earlier transition.
                            finish()
                        }
                    }
                }.resume()
            }

            AttendanceNativeCredentialRefresher.accessToken(
                baseUrl: baseUrl,
                forceRefresh: false
            ) { token in
                workQueue.async {
                    guard let token = token else {
                        AttendanceNativeDiagnostics.record(
                            code: "credential_load_failed",
                            stage: "credential",
                            status: "failed"
                        )
                        UserDefaults.standard.set("No valid attendance credential", forKey: "gw_last_error")
                        finish()
                        return
                    }
                    AttendanceNativeDiagnostics.record(
                        code: "credential_loaded",
                        stage: "credential",
                        status: "succeeded"
                    )
                    send(0, token: token, refreshedAfterUnauthorized: false)
                }
            }
        }
    }
}

/// Fetch and apply the server's current assigned-region plan without cookies.
///
/// Significant-location wakes are the durable reconciliation trigger when the
/// app has not been opened: movement that can lead to a jobsite also gives iOS
/// an opportunity to repair missing regions or pick up a changed assignment.
enum AttendanceNativePlanSync {
    private static let workQueue = DispatchQueue(label: "com.groundworkpro.attendance.plan")
    private static var inFlight = false
    private static var lastStartedAt: Date? = nil
    private static let minimumInterval: TimeInterval = 60

    static func sync(reason: String, force: Bool = false) {
        workQueue.async {
            if !force,
               let lastStartedAt = lastStartedAt,
               Date().timeIntervalSince(lastStartedAt) < minimumInterval {
                return
            }
            guard !inFlight else { return }
            let baseUrl = UserDefaults.standard.string(forKey: "gw_server_base_url") ?? ""
            guard !baseUrl.isEmpty else { return }
            inFlight = true
            lastStartedAt = Date()
            AttendanceNativeDiagnostics.record(
                code: "monitoring_plan_sync",
                stage: "assignment_reconciliation",
                status: "started",
                details: ["reason": reason]
            )

            AttendanceNativeCredentialRefresher.accessToken(
                baseUrl: baseUrl,
                forceRefresh: false
            ) { token in
                workQueue.async {
                    guard
                        let token = token,
                        let url = URL(string: "\(baseUrl)/api/attendance/monitoring-plan")
                    else {
                        inFlight = false
                        AttendanceNativeDiagnostics.record(
                            code: "monitoring_plan_sync",
                            stage: "assignment_reconciliation",
                            status: "failed",
                            details: ["reason": "no valid attendance credential"]
                        )
                        return
                    }

                    var request = URLRequest(url: url)
                    request.httpMethod = "GET"
                    request.timeoutInterval = 20
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    URLSession.shared.dataTask(with: request) { data, response, error in
                        workQueue.async {
                            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                            guard
                                error == nil,
                                (200...299).contains(status),
                                let data = data,
                                let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                                let regions = payload["regions"] as? [JSObject]
                            else {
                                inFlight = false
                                AttendanceNativeDiagnostics.record(
                                    code: "monitoring_plan_sync",
                                    stage: "assignment_reconciliation",
                                    status: "failed",
                                    details: [
                                        "httpStatus": status,
                                        "reason": error?.localizedDescription ?? "invalid monitoring plan",
                                    ]
                                )
                                return
                            }
                            DispatchQueue.main.async {
                                let registered = AttendanceGeofenceCoordinator.shared.reconcile(regions)
                                AttendanceNativeDiagnostics.record(
                                    code: "monitoring_plan_sync",
                                    stage: "assignment_reconciliation",
                                    status: "succeeded",
                                    details: ["httpStatus": status, "registered": registered]
                                )
                                inFlight = false
                            }
                        }
                    }.resume()
                }
            }
        }
    }
}

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
    var authorizationSink: ((JSObject) -> Void)?
    private var started = false
    private var stateRequests = Set<String>()
    private static let desiredRegionsKey = "gw_desired_attendance_regions_v1"

    func start(launchReason: String = "capacitor_plugin") {
        let firstStart = !started
        if !started {
            manager.delegate = self
            manager.pausesLocationUpdatesAutomatically = false
            started = true
            AttendanceNativeDiagnostics.record(
                code: "process_launch",
                stage: "launch",
                status: "observed",
                details: ["reason": launchReason]
            )
        }
        if manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        }
        updateSignificantLocationMonitoring()
        if firstStart {
            restorePersistedRegions()
        }
        if launchReason == "core_location" {
            for region in manager.monitoredRegions {
                stateRequests.insert(region.identifier)
                AttendanceNativeDiagnostics.record(
                    code: "region_state_requested",
                    stage: "region_state",
                    status: "started",
                    regionIdentifier: region.identifier,
                    details: ["reason": "core_location_relaunch"]
                )
                manager.requestState(for: region)
            }
        }
        AttendanceNativeDelivery.drain()
        AttendanceNativeReadinessReporter.submit(manager: manager)
        if launchReason != "capacitor_plugin" {
            AttendanceNativePlanSync.sync(reason: launchReason, force: true)
        }
    }

    private func restorePersistedRegions() {
        let regions = UserDefaults.standard.array(forKey: Self.desiredRegionsKey) as? [JSObject] ?? []
        guard !regions.isEmpty else { return }
        AttendanceNativeDiagnostics.record(
            code: "persisted_regions_restored",
            stage: "region_registration",
            status: "started",
            details: ["count": regions.count]
        )
        _ = reconcile(regions)
    }

    private func updateSignificantLocationMonitoring() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        if manager.authorizationStatus == .authorizedAlways {
            manager.startMonitoringSignificantLocationChanges()
        } else {
            manager.stopMonitoringSignificantLocationChanges()
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
                AttendanceNativeDiagnostics.record(
                    code: "region_registered",
                    stage: "region_registration",
                    status: "observed",
                    regionIdentifier: identifier,
                    details: ["source": "existing"]
                )
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
            stateRequests.insert(identifier)
            manager.startMonitoring(for: circular)
        }

        UserDefaults.standard.set(desiredById.count, forKey: "gw_registered_count")
        UserDefaults.standard.set(Array(desiredById.keys).sorted(), forKey: "gw_required_region_ids")
        UserDefaults.standard.set(
            desiredById.keys.sorted().compactMap { desiredById[$0] },
            forKey: Self.desiredRegionsKey
        )
        AttendanceNativeReadinessReporter.submit(manager: manager)
        return desiredById.count
    }

    func removeAll() {
        start()
        stateRequests.removeAll()
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        UserDefaults.standard.set(0, forKey: "gw_registered_count")
        UserDefaults.standard.set([], forKey: "gw_required_region_ids")
        UserDefaults.standard.set([], forKey: Self.desiredRegionsKey)
        AttendanceNativeReadinessReporter.submit(manager: manager)
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
        AttendanceNativeDiagnostics.record(
            code: "region_registered",
            stage: "region_registration",
            status: "succeeded",
            regionIdentifier: region.identifier,
            details: ["source": "did_start_monitoring"]
        )
        // Core Location does not guarantee an enter callback when monitoring is
        // first installed while the device is already inside. Determine the
        // initial state only for a newly-added region; unchanged registrations
        // are never re-fired on an ordinary app launch.
        if stateRequests.contains(region.identifier) {
            AttendanceNativeDiagnostics.record(
                code: "region_state_requested",
                stage: "region_state",
                status: "started",
                regionIdentifier: region.identifier,
                details: ["reason": "new_registration"]
            )
            manager.requestState(for: region)
        }
        AttendanceNativeReadinessReporter.submit(manager: manager)
    }

    func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        guard stateRequests.remove(region.identifier) != nil else { return }
        let nextState: String
        switch state {
        case .inside: nextState = "inside"
        case .outside: nextState = "outside"
        case .unknown: nextState = "unknown"
        }
        AttendanceNativeDiagnostics.record(
            code: "region_state_result",
            stage: "region_state",
            status: "observed",
            regionIdentifier: region.identifier,
            details: ["state": nextState]
        )
        guard state != .unknown else { return }
        let previous = persistedRegionState(region.identifier)
        setPersistedRegionState(region.identifier, state: nextState)
        if state == .inside && previous != "inside" {
            handleTransition(region: region, transition: "enter")
        } else if state == .outside && previous == "inside" {
            handleTransition(region: region, transition: "exit")
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        AttendanceNativeDiagnostics.record(
            code: "did_enter_region",
            stage: "region_callback",
            status: "observed",
            regionIdentifier: region.identifier,
            transition: "enter"
        )
        setPersistedRegionState(region.identifier, state: "inside")
        handleTransition(region: region, transition: "enter")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        AttendanceNativeDiagnostics.record(
            code: "did_exit_region",
            stage: "region_callback",
            status: "observed",
            regionIdentifier: region.identifier,
            transition: "exit"
        )
        setPersistedRegionState(region.identifier, state: "outside")
        handleTransition(region: region, transition: "exit")
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !locations.isEmpty else { return }
        AttendanceNativeDiagnostics.record(
            code: "significant_location_wake",
            stage: "assignment_reconciliation",
            status: "observed"
        )
        AttendanceNativePlanSync.sync(reason: "significant_location", force: true)
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        if let identifier = region?.identifier {
            stateRequests.remove(identifier)
        }
        UserDefaults.standard.set(error.localizedDescription, forKey: "gw_last_error")
        AttendanceNativeDiagnostics.record(
            code: "region_monitoring_failed",
            stage: "region_registration",
            status: "failed",
            regionIdentifier: region?.identifier,
            details: ["reason": error.localizedDescription]
        )
        AttendanceNativeReadinessReporter.submit(manager: manager)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let authorizedAlways = manager.authorizationStatus == .authorizedAlways
        if authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
        } else {
            manager.allowsBackgroundLocationUpdates = false
        }
        updateSignificantLocationMonitoring()
        authorizationSink?([
            "authorized": authorizedAlways,
            "authorizationStatus": authorizationStatus(manager.authorizationStatus)
        ])
        // Native credential-backed reporting keeps CEO readiness authoritative
        // even when Apple's reminder suspends the WebView.
        AttendanceNativeReadinessReporter.submit(manager: manager)
        if authorizedAlways {
            AttendanceNativePlanSync.sync(reason: "authorization_restored", force: true)
        }
    }

    private func authorizationStatus(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "not_determined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedWhenInUse: return "authorized_when_in_use"
        case .authorizedAlways: return "authorized_always"
        @unknown default: return "unknown"
        }
    }

    private func persistedRegionState(_ identifier: String) -> String? {
        let states = UserDefaults.standard.dictionary(forKey: "gw_region_states") as? [String: String]
        return states?[identifier]
    }

    private func setPersistedRegionState(_ identifier: String, state: String) {
        var states = UserDefaults.standard.dictionary(forKey: "gw_region_states") as? [String: String] ?? [:]
        states[identifier] = state
        UserDefaults.standard.set(states, forKey: "gw_region_states")
    }

    private func handleTransition(region: CLRegion, transition: String) {
        let parts = region.identifier.split(separator: ":", maxSplits: 1)
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
        let recentLocation = manager.location.flatMap { location -> CLLocation? in
            guard
                location.horizontalAccuracy >= 0,
                abs(location.timestamp.timeIntervalSinceNow) <= 5 * 60
            else { return nil }
            return location
        }
        event["latitude"] = recentLocation?.coordinate.latitude
        event["longitude"] = recentLocation?.coordinate.longitude
        event["accuracyMeters"] = recentLocation?.horizontalAccuracy
        eventSink?(event)

        AttendanceNativeDelivery.enqueueAndDrain(
            jobId: jobId,
            zone: zone,
            transition: transition,
            occurredAt: occurredAt,
            latitude: recentLocation?.coordinate.latitude,
            longitude: recentLocation?.coordinate.longitude,
            accuracyMeters: recentLocation?.horizontalAccuracy
        )
        // Also reconcile assignment/regions while iOS has granted background
        // execution. If this callback belonged to a stale assignment, the new
        // region is installed and requestState(for:) can emit the real arrival.
        AttendanceNativePlanSync.sync(reason: "region_transition", force: true)
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
        coordinator.authorizationSink = { [weak self] event in
            self?.notifyListeners("geofenceAuthorizationChanged", data: event)
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
            "backgroundRefreshEnabled": UIApplication.shared.backgroundRefreshStatus == .available,
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

}
