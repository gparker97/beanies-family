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
        CAPPluginMethod(name: "deleteKey", returnType: CAPPluginReturnPromise),
        // A new @objc func that is NOT listed here is invisible to Capacitor and rejects
        // as not-implemented. That is exactly how #74 happened, twice. Anything added
        // below must be added here in the same edit.
        CAPPluginMethod(name: "deleteAllKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listAccounts", returnType: CAPPluginReturnPromise)
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

        // Idempotent re-enable: remove any prior item first. This status is deliberately
        // DISCARDED and that is correct — the delete is advisory, and the SecItemAdd below
        // is the operation whose outcome is reported. Do NOT "fix" it into a failure to
        // match deleteKey: a first-time enable has nothing to delete and would then reject.
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
            // A missing account is a CALLER bug, not an absent key. Resolving
            // {present: false} here reported the same false-absent as the 0.13R2 bug
            // described below, only arriving from the JS side, and `nativeUnlock` then
            // deleted a live record to "self-heal". A reject is handled there as
            // "fall through to the real unlock", logged and harmless.
            call.reject("account is required", "unknown")
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
        guard let account = call.getString("account"), !account.isEmpty else {
            // Never resolve here. A caller asking for key material to be removed and
            // being told it succeeded, while nothing was touched, is the exact shape of
            // the #82 defect this plugin is being audited for.
            call.reject("account is required", "unknown")
            return
        }
        let status = SecItemDelete(baseQuery(account) as CFDictionary)
        // errSecItemNotFound is a SUCCESS for an idempotent delete, and must be
        // short-circuited BEFORE mapOSStatus, which maps it to "invalidated" (see below)
        // and would turn every repeat delete into a spurious re-enrol prompt.
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("keychain delete failed", mapOSStatus(status))
        }
    }

    // MARK: - listAccounts (enumerate)

    /// Every account this device holds under our service — the app's DURABLE index.
    ///
    /// Keychain items survive an app uninstall by design; the IndexedDB registry that
    /// used to be the only way to enumerate them does not. Because the account encodes
    /// `${familyId}:${memberId}`, a query by SERVICE ALONE recovers every pair, which is
    /// what lets a reinstall adopt its own material back instead of orphaning it beyond
    /// every deletion path (#82). The keychain was always the index; the plugin just
    /// never exposed it, because every other method pins `kSecAttrAccount`.
    ///
    /// ⚠️ This query asks for `kSecReturnAttributes` ONLY, and that is the entire basis
    /// of the method. Do NOT "simplify" it toward `hasKey`'s shape below. `hasKey`
    /// passes NO return-type key, so for a generic-password item the keychain returns
    /// the item's DATA — which is why it evaluates the access control, and why its
    /// comment reports `errSecInteractionNotAllowed` as the healthy status for a gated
    /// item. Attributes are metadata: the encrypted data is never touched, so the ACL
    /// should not be evaluated and no prompt should appear. Reading hasKey's behaviour
    /// as a prediction of this one is exactly how someone "fixes" this into a Face ID
    /// prompt on the login screen.
    ///
    /// NEVER use `kSecUseAuthenticationUISkip` (see hasKey's 0.13R2 note — Skip makes
    /// gated items silently vanish from results, and the JS self-heal then deleted live
    /// enrolments). The `LAContext` with `interactionNotAllowed` is carried from the
    /// outset so that IF the OS ever does decide authentication is needed, this rejects
    /// deterministically instead of surprising the user with a prompt.
    @objc func listAccounts(_ call: CAPPluginCall) {
        let ctx = LAContext()
        ctx.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
            kSecUseAuthenticationContext as String: ctx
        ]
        // A keychain IPC round-trip on a rendering login screen — off the main thread,
        // same treatment as getKey.
        DispatchQueue.global(qos: .userInitiated).async {
            var items: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &items)
            DispatchQueue.main.async {
                if status == errSecItemNotFound {
                    // A legitimately empty device. Not a failure.
                    call.resolve(["accounts": [String]()])
                    return
                }
                guard status == errSecSuccess else {
                    // Including errSecInteractionNotAllowed. A caller MUST be able to
                    // tell "no items" from "the query failed": an empty list on failure
                    // is precisely how a broken probe becomes "nothing is enrolled".
                    call.reject("keychain enumerate failed", self.mapOSStatus(status))
                    return
                }
                let attrs = items as? [[String: Any]] ?? []
                call.resolve([
                    "accounts": attrs.compactMap { $0[kSecAttrAccount as String] as? String }
                ])
            }
        }
    }

    // MARK: - deleteAllKeys (explicit clear-all)

    /// Remove EVERY item this app holds for our service on this device.
    ///
    /// One `SecItemDelete` over class + service with NO account: it needs no
    /// authentication and returns no attributes, so unlike an enumerate-then-delete it
    /// cannot miss a biometry-gated item. That is deliberate — it makes the product's
    /// strongest promise ("clear all data really clears it") independent of any
    /// assumption about how the keychain treats access-controlled items in a query.
    ///
    /// `nativeReclaimAllKeystores` in `nativeBiometric.ts` is the ONLY permitted caller.
    /// Everything else reclaims per family, so a bug there cannot reach another family.
    @objc func deleteAllKeys(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        let status = SecItemDelete(query as CFDictionary)
        // Nothing to delete is a clean device, not a failure. `deleted` says whether an
        // item was actually removed, which is the only part a caller could not infer.
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve(["deleted": status == errSecSuccess])
        } else {
            call.reject("keychain sweep failed", mapOSStatus(status))
        }
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
