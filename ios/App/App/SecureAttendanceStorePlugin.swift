import Foundation
import Security
import Capacitor

// Secure storage for the device attendance credential (iOS Keychain).
//
// The credential is a bearer token that authenticates background attendance
// submissions. It must be readable by the geofence handler when the app is
// woken after a reboot — before the user has unlocked the phone — which is why
// the accessibility class is `AfterFirstUnlockThisDeviceOnly` rather than
// `WhenUnlocked`.
//
// `ThisDeviceOnly` is deliberate: the token is bound to (company, user, device)
// server-side, so restoring an encrypted backup onto a NEW phone must not carry
// a credential that claims to be the old one.
//
// Until this existed, enrollDeviceCredential() correctly refused to mint a
// token — it will not create a credential it cannot store securely — so
// background submission had no way to authenticate at all.
@objc(SecureAttendanceStorePlugin)
public class SecureAttendanceStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureAttendanceStorePlugin"
    public let jsName = "SecureAttendanceStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private static let service = "com.groundworkpro.attendance"
    private static let account = "attendance-credential"
    private static let expiresAtKey = "gw_attendance_token_expires_at"

    // MARK: - Keychain primitives (also used by the geofence handler)

    static func save(token: String, expiresAt: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        // Delete-then-add: SecItemUpdate cannot change the accessibility class,
        // so a rotated token would silently keep the old one's protection.
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess {
            UserDefaults.standard.set(expiresAt, forKey: expiresAtKey)
            return true
        }
        return false
    }

    /// The stored token, or nil. Safe to call from a background region callback.
    static func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty
        else { return nil }
        return token
    }

    static func hasCredential() -> Bool {
        loadToken() != nil
    }

    @discardableResult
    static func clearToken() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: expiresAtKey)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Plugin surface

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token required")
            return
        }
        let expiresAt = call.getString("expiresAt") ?? ""
        if Self.save(token: token, expiresAt: expiresAt) {
            call.resolve()
        } else {
            call.reject("Failed to store the attendance credential in the Keychain")
        }
    }

    /// Reports only WHETHER a credential exists and when it expires — never the
    /// token itself. The web layer has no reason to hold the plaintext, and the
    /// whole point of the Keychain is that it does not leave it.
    @objc func getToken(_ call: CAPPluginCall) {
        call.resolve([
            "hasToken": Self.hasCredential(),
            "expiresAt": UserDefaults.standard.string(forKey: Self.expiresAtKey) ?? ""
        ])
    }

    @objc func clear(_ call: CAPPluginCall) {
        Self.clearToken()
        call.resolve()
    }
}
