import Foundation
import Capacitor

// Durable storage for the offline attendance queue (iOS).
//
// Why not localStorage: the app is a remote-URL Capacitor shell, so the queue
// would live in WKWebView web storage — which iOS may evict under storage
// pressure and which is cleared by ordinary web-data resets. Attendance that
// survives being offline but not being backgrounded for two days is not
// durable.
//
// Why not the Keychain: the queue holds no secrets (the attendance credential
// lives in the Keychain via SecureAttendanceStore). This is about DURABILITY.
// The file lives in Application Support — inside the app container, not
// user-visible, removed with the app — with
// `.completeUntilFirstUserAuthentication` protection so the native geofence
// handler can read and append to it after a device restart but before the user
// has unlocked the phone.
//
// This plugin and AttendanceNativeQueue read and write the SAME file, so a
// transition queued natively in the background is flushed by the JS retry
// policy, and diagnostics report one depth rather than two.
@objc(AttendanceQueueStorePlugin)
public class AttendanceQueueStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AttendanceQueueStorePlugin"
    public let jsName = "AttendanceQueueStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    @objc func load(_ call: CAPPluginCall) {
        do {
            let url = try AttendanceNativeQueue.fileURL()
            guard FileManager.default.fileExists(atPath: url.path) else {
                call.resolve(["value": NSNull()])
                return
            }
            let data = try Data(contentsOf: url)
            call.resolve(["value": String(data: data, encoding: .utf8) ?? ""])
        } catch {
            // A read failure must not break attendance: the JS layer falls back
            // to its localStorage mirror.
            call.resolve(["value": NSNull()])
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("value required")
            return
        }
        do {
            let url = try AttendanceNativeQueue.fileURL()
            // Atomic so a kill mid-write cannot leave a truncated queue: the
            // write lands in a temp file and is renamed into place.
            try value.data(using: .utf8)?.write(
                to: url,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            call.resolve()
        } catch {
            call.reject("Failed to persist attendance queue: \(error.localizedDescription)")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        do {
            let url = try AttendanceNativeQueue.fileURL()
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            UserDefaults.standard.set(0, forKey: "gw_pending_queue_count")
            call.resolve()
        } catch {
            call.reject("Failed to clear attendance queue: \(error.localizedDescription)")
        }
    }
}
