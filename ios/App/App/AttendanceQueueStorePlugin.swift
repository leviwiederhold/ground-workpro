import Foundation
import Capacitor

// Durable storage for the offline attendance queue (iOS).
//
// STATUS: REFERENCE IMPLEMENTATION — NOT YET WIRED INTO THE BUILD OR VERIFIED ON
// A PHYSICAL DEVICE. See docs/attendance-offline-sync.md. Until the plugin is
// registered in the Xcode project and exercised on a real phone, the JS layer
// falls back to localStorage and offline durability across a device restart is
// NOT proven.
//
// Why not localStorage: the app is a remote-URL Capacitor shell, so the queue
// would live in WKWebView web storage — which iOS may evict under storage
// pressure and which is cleared by ordinary web-data resets. Attendance that
// survives being offline but not being backgrounded for two days is not durable.
//
// Why not the Keychain: the queue holds no secrets (the attendance credential
// lives in the Keychain via SecureAttendanceStore). This is about DURABILITY.
// The file lives in Application Support — inside the app container, not
// user-visible, and removed with the app — with
// `.completeUntilFirstUserAuthentication` data protection so the native
// geofence handler can still read and append to it after a device restart but
// before the user has unlocked the phone.

@objc(AttendanceQueueStorePlugin)
public class AttendanceQueueStorePlugin: CAPPlugin {
    // Shared with the native geofence handler, which appends to the same queue
    // when a background transition cannot be POSTed immediately.
    static let fileName = "attendance-queue.json"

    static func fileURL() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = base.appendingPathComponent("GroundworkPro", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(fileName)
    }

    @objc func load(_ call: CAPPluginCall) {
        do {
            let url = try Self.fileURL()
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
            let url = try Self.fileURL()
            // Atomic so a kill mid-write cannot leave a truncated queue: the
            // write lands in a temp file and is renamed into place.
            try value.data(using: .utf8)?.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            call.resolve()
        } catch {
            call.reject("Failed to persist attendance queue: \(error.localizedDescription)")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        do {
            let url = try Self.fileURL()
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            call.resolve()
        } catch {
            call.reject("Failed to clear attendance queue: \(error.localizedDescription)")
        }
    }
}
