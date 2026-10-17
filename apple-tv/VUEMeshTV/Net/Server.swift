import Foundation
import Security

/// Where VUEMesh lives. The site's /config.js (written at deploy) names the API and signalling
/// endpoints, so the TV reads it rather than baking them in: point Server at the dev server
/// (http://<laptop>:8790) to test against `node dev/server.mjs`.
struct Server {
    static let defaultBase = "https://vuemesh.com"
    static let stun = ["stun:stun.l.google.com:19302"] // (vm.js ICE)

    let base: URL
    let api: URL
    let ws: URL

    static func load(base: String) async throws -> Server {
        guard let baseURL = URL(string: base.trimmingCharacters(in: .whitespaces)) else { throw TVError.badServer }
        let (data, _) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("config.js"))
        let text = String(decoding: data, as: UTF8.self)
        func value(_ key: String) -> String? {
            guard let r = text.range(of: "\(key):\\s*'([^']*)'", options: .regularExpression) else { return nil }
            return String(text[r]).components(separatedBy: "'").dropFirst().first
        }
        guard let apiRaw = value("api"), let wsRaw = value("ws"),
              let api = URL(string: apiRaw, relativeTo: baseURL)?.absoluteURL,
              let ws = URL(string: wsRaw, relativeTo: baseURL)?.absoluteURL else { throw TVError.badServer }
        return Server(base: baseURL, api: api, ws: ws)
    }

    struct Event: Decodable {
        let id: String
        let title: String
        let orientation: String?
        let live: Bool?
    }

    /// GET /api/events/{code}: 404 when there's no such event.
    func event(_ code: String) async throws -> Event {
        let (data, res) = try await URLSession.shared.data(from: api.appendingPathComponent("events/\(code)"))
        guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw TVError.noEvent }
        return try JSONDecoder().decode(Event.self, from: data)
    }
}

enum TVError: Error {
    case badServer, noEvent
}

/// The event-code alphabet (no 0/O, 1/I/L: read off a screen), as common.mjs.
enum Codes {
    static let chars = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    static func valid(_ s: String, length: Int) -> Bool {
        s.count == length && s.allSatisfy { chars.contains($0) }
    }
}

/// Small secrets: the studio's key for this TV, per event, and this TV's own id.
enum Keychain {
    private static let service = "com.vuemesh.tv"

    static func get(_ account: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ account: String, _ value: String?) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
        guard let value else { return }
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    /// This TV's id for the studio (survives relaunches), like the browser's vm_tv_cid.
    static var deviceId: String {
        if let v = get("cid") { return v }
        let v = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
        set("cid", v)
        return v
    }
}
