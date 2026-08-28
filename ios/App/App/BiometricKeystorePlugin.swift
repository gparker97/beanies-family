import Foundation
import Capacitor
import LocalAuthentication
import Security

/**
 * Hardware-backed, biometric-gated storage for the family AES key (#52 Keystore
 * pivot, ADR-029 2026-07-14). Replaces the retired native WebAuthn-PRF path; web/PWA
 * keeps WebAuthn-PRF.
 *
 * The raw family key is stored as a biometric-gated Keychain item —
 * `SecAccessControl(.biometryCurrentSet)` + `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
 * — so the read itself requires a live Face ID / Touch ID and the item is discarded by
 * the Secure Enclave if the enrolled biometric set changes. The item is device-local
 * (ThisDeviceOnly, never synced/backed up). Requires `NSFaceIDUsageDescription`.
 *
 * `keyB64` crosses the bridge as STANDARD base64 (matches the JS `bufferToBase64` /
 * Android `Base64.NO_WRAP`). All rejects carry a typed code
 * (userCancel/notEnrolled/lockout/invalidated/unknown) — never a raw platform string.
 */
@objc(BiometricKeystorePlugin)
public class BiometricKeystorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BiometricKeystorePlugin"
    public let jsName = "BiometricKeystore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteKey", returnType: CAPPluginReturnPromise)
    ]

    private let service = "family.beanies.app.biometric"

    // MARK: - isAvailable

    @objc func isAvailable(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var error: NSError?
        let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        var ret: [String: Any] = ["available": ok]
        switch ctx.biometryType {
        case .faceID: ret["biometryType"] = "faceId"
        case .touchID: ret["biometryType"] = "touchId"
        default: ret["biometryType"] = "none"
        }
        if !ok, let e = error { ret["reason"] = "code_\(e.code)" }
        call.resolve(ret)
    }

    // MARK: - setKey (enable)

    @objc func setKey(_ call: CAPPluginCall) {
        guard let account = call.getString("account"), !account.isEmpty,
              let keyB64 = call.getString("keyB64"), !keyB64.isEmpty,
              let raw = Data(base64Encoded: keyB64) else {
            call.reject("account and keyB64 are required", "unknown")
            return
        }

        var acError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            &acError
        ) else {
            call.reject("access control failed", "unknown")
            return
        }

        // Idempotent re-enable: remove any prior item first.
        SecItemDelete(baseQuery(account) as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: raw,
            kSecAttrAccessControl as String: access,
            kSecUseAuthenticationContext as String: LAContext()
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve(["keyBacking": "secureEnclave"])
        } else {
            call.reject("keychain add failed", mapOSStatus(status))
        }
    }

    // MARK: - getKey (unlock)

    @objc func getKey(_ call: CAPPluginCall) {
        guard let account = call.getString("account"), !account.isEmpty else {
            call.reject("account is required", "unknown")
            return
        }
        let ctx = LAContext()
        ctx.localizedReason = "Unlock beanies.family"
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = ctx
        query[kSecUseOperationPrompt as String] = "Unlock beanies.family"

        // SecItemCopyMatching triggers the biometric prompt; run off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            DispatchQueue.main.async {
                if status == errSecSuccess, let data = item as? Data {
                    call.resolve(["keyB64": data.base64EncodedString(), "keyBacking": "secureEnclave"])
                } else {
                    call.reject("keychain read failed", self.mapOSStatus(status))
                }
            }
        }
    }

    // MARK: - hasKey / deleteKey

    @objc func hasKey(_ call: CAPPluginCall) {
        guard let account = call.getString("account"), !account.isEmpty else {
            call.resolve(["present": false])
            return
        }
        var query = baseQuery(account)
        // Do NOT prompt — but NEVER use kSecUseAuthenticationUISkip here: Skip makes
        // SecItemCopyMatching silently EXCLUDE access-controlled items from the results,
        // so a healthy biometry-gated key came back errSecItemNotFound and the JS
        // self-heal deleted live enrolments ("biometrics changed" on every unlock —
        // 0.13R2 field bug). An LAContext with interactionNotAllowed makes a gated
        // match return errSecInteractionNotAllowed instead, which is exactly the
        // "present but locked" signal this probe exists to read.
        let ctx = LAContext()
        ctx.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = ctx
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        let present = status == errSecSuccess || status == errSecInteractionNotAllowed
        call.resolve(["present": present])
    }

    @objc func deleteKey(_ call: CAPPluginCall) {
        if let account = call.getString("account"), !account.isEmpty {
            SecItemDelete(baseQuery(account) as CFDictionary)
        }
        call.resolve()
    }

    // MARK: - Helpers

    private func baseQuery(_ account: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func mapOSStatus(_ status: OSStatus) -> String {
        switch status {
        case errSecUserCanceled:
            return "userCancel"
        case errSecItemNotFound:
            // Item gone — for a biometryCurrentSet item this also happens after the
            // enrolled biometric set changes → treat as invalidated (re-enroll).
            return "invalidated"
        case errSecAuthFailed:
            return "invalidated"
        default:
            // LAError.biometryLockout surfaces here as a distinct code on some OS
            // versions; without a reliable constant we degrade to `unknown`, which the
            // JS layer shows as a friendly generic error + password fallback.
            return "unknown"
        }
    }
}
