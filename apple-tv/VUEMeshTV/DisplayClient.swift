import Foundation
import UIKit

/// The TV's side of the display protocol (docs/APPLE-TV.md), step for step the same as
/// public/js/tv.js: look the event up, join its signalling as a "display", say hello to the
/// studio, wait to be let in (Accept, or a TV code), offer a receive-only connection, and show
/// what the studio sends on it.
@MainActor
final class DisplayClient: ObservableObject {
    enum Phase: Equatable {
        case join            // asking for the event code
        case looking         // event found, signalling opening
        case noStudio        // the studio isn't open
        case waitingAccept   // the studio hasn't let this TV in yet
        case connecting
        case program
        case standby
        case unreachable     // can't reach the studio on this network
    }

    static let version = 1

    @Published var phase: Phase = .join
    @Published var title = ""
    @Published var route = ""
    @Published var message = ""      // an error or a note under the status
    @Published var codeError = false // the last code was wrong
    @Published var screenName: String {
        didSet { UserDefaults.standard.set(screenName, forKey: "screenName") }
    }
    @Published var serverBase: String {
        didSet { UserDefaults.standard.set(serverBase, forKey: "serverBase") }
    }

    let renderer = SampleBufferRenderer()
    private(set) var eventId = ""
    private var server: Server?
    private var sock: MeshSocket?
    private var host: String?
    private var link: PeerLink?
    private var pingTimer: Timer?
    private var iceTimer: Timer?
    private var lastPong = Date()
    private var seq = 0
    private let cid = Keychain.deviceId

    init() {
        screenName = UserDefaults.standard.string(forKey: "screenName") ?? UIDevice.current.name
        serverBase = UserDefaults.standard.string(forKey: "serverBase") ?? Server.defaultBase
        renderer.onFirstFrame = { [weak self] in self?.objectWillChange.send() }
        if let last = UserDefaults.standard.string(forKey: "lastEvent") {
            Task { await join(last) }
        }
    }

    private var key: String? {
        get { Keychain.get("key_" + eventId) }
        set { Keychain.set("key_" + eventId, newValue) }
    }

    // MARK: joining

    func join(_ code: String) async {
        let code = code.uppercased()
        guard Codes.valid(code, length: 6) else {
            codeError = true
            message = "Event codes are 6 letters and numbers."
            return
        }
        message = ""
        codeError = false
        do {
            let server = try await Server.load(base: serverBase)
            let ev = try await server.event(code)
            self.server = server
            eventId = code
            title = ev.title
            UserDefaults.standard.set(code, forKey: "lastEvent")
        } catch TVError.noEvent {
            codeError = true
            message = "No event with that code. Check it on the studio or a beacon."
            phase = .join
            return
        } catch {
            message = "Can’t reach VUEMesh at \(serverBase). Check the network, or the server in Settings."
            phase = .join
            return
        }
        phase = .looking
        sock?.close()
        let s = MeshSocket(ws: server!.ws, eventId: eventId, name: screenName, cid: cid)
        s.onPeers = { [weak self] peers in self?.peers(peers) }
        s.onSignal = { [weak self] from, data in self?.signal(from: from, data: data) }
        sock = s
        s.open()
    }

    func leave() {
        drop()
        sock?.close()
        sock = nil
        host = nil
        eventId = ""
        title = ""
        UserDefaults.standard.removeObject(forKey: "lastEvent")
        phase = .join
    }

    private func peers(_ peers: [MeshSocket.Peer]) {
        guard let h = peers.first(where: { $0.role == "host" }) else {
            if host != nil { drop() }
            host = nil
            phase = .noStudio
            return
        }
        if h.peer != host {
            drop()
            host = h.peer
            hello()
        }
    }

    private func say(_ display: [String: Any]) {
        guard let host else { return }
        var d = display
        d["v"] = Self.version
        sock?.signal(host, ["display": d])
    }

    private func hello() {
        let scale = UIScreen.main.scale, b = UIScreen.main.bounds
        var m: [String: Any] = [
            "t": "hello", "name": screenName, "model": "Apple TV", "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "caps": ["program"], "screen": ["w": Int(b.width * scale), "h": Int(b.height * scale), "hdr": false],
        ]
        if let key { m["key"] = key }
        say(m)
    }

    func pair(_ code: String) {
        codeError = false
        message = ""
        say(["t": "pair", "code": code.uppercased(), "name": screenName, "model": "Apple TV"])
    }

    private func signal(from: String, data: [String: Any]) {
        guard from == host else { return }
        if let d = data["display"] as? [String: Any] { return display(d) }
        switch data["kind"] as? String {
        case "answer":
            if let sdp = (data["sdp"] as? [String: Any])?["sdp"] as? String { link?.setAnswer(sdp) }
        case "ice":
            if let c = data["c"] as? [String: Any], let cand = c["candidate"] as? String {
                link?.addIce(candidate: cand, sdpMid: c["sdpMid"] as? String, sdpMLineIndex: Int32(c["sdpMLineIndex"] as? Int ?? 0))
            }
        case "restart":
            restart()
        default:
            break
        }
    }

    private func display(_ m: [String: Any]) {
        switch m["t"] as? String {
        case "waiting":
            phase = .waitingAccept
        case "paired":
            key = m["key"] as? String
            if let t = m["title"] as? String, !t.isEmpty { title = t }
            phase = .connecting
            offer()
        case "reject":
            let code = m["code"] as? String ?? ""
            message = m["message"] as? String ?? "The studio turned this screen away."
            if code == "wrong_code" || code == "code_expired" {
                codeError = true
                return
            }
            if code == "removed" {
                key = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.hello() }
            }
            drop()
            phase = .waitingAccept
        default:
            break
        }
    }

    // MARK: the connection

    private func offer() {
        drop()
        let link = PeerLink(stunURLs: Server.stun) { [weak self] event in
            MainActor.assumeIsolated { self?.peerEvent(event) }
        }
        self.link = link
        // No connection in 10 s: almost always two networks, or Wi-Fi that keeps devices apart.
        iceTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.phase == .connecting else { return }
                self.notReachable()
            }
        }
        link.makeOffer()
    }

    private func peerEvent(_ e: PeerLink.Event) {
        guard let host else { return }
        switch e {
        case .offer(let sdp):
            sock?.signal(host, ["kind": "offer", "sdp": ["type": "offer", "sdp": sdp]])
        case .ice(let candidate, let mid, let index):
            var c: [String: Any] = ["candidate": candidate, "sdpMLineIndex": Int(index)]
            if let mid { c["sdpMid"] = mid }
            sock?.signal(host, ["kind": "ice", "c": c])
        case .ctlOpen:
            lastPong = Date()
            pingTimer?.invalidate()
            pingTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if Date().timeIntervalSince(self.lastPong) > 15 {
                        self.message = "The studio stopped answering."
                        return self.restart()
                    }
                    self.seq += 1
                    self.link?.send(["t": "ping", "seq": self.seq])
                }
            }
        case .ctlMessage(let m):
            lastPong = Date()
            switch m["t"] as? String {
            case "mode": setMode(m["mode"] as? String ?? "idle")
            case "meta": if let t = m["title"] as? String, !t.isEmpty { title = t }
            default: break
            }
        case .connected(let r):
            iceTimer?.invalidate()
            route = ["lan": "this network", "nat": "through the router", "relay": "relayed"][r] ?? ""
        case .failed:
            notReachable()
        case .videoTrack(let track):
            renderer.reset()
            track.add(renderer)
        }
    }

    private func setMode(_ mode: String) {
        phase = mode == "program" ? .program : .standby
        state("active", ["mode": mode == "program" ? "program" : "idle"])
    }

    private func state(_ status: String, _ extra: [String: Any] = [:]) {
        var m: [String: Any] = ["t": "state", "status": status]
        m.merge(extra) { $1 }
        if phase == .program || phase == .standby { link?.send(m) } else { say(m) }
    }

    private func notReachable() {
        state("error", ["detail": "ice_failed_same_network"])
        phase = .unreachable
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self, self.host != nil, self.phase == .unreachable else { return }
            self.restart()
        }
    }

    private func restart() {
        if let host { sock?.signal(host, ["kind": "restart"]) }
        phase = .connecting
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self, self.host != nil else { return }
            self.offer()
        }
    }

    private func drop() {
        pingTimer?.invalidate()
        iceTimer?.invalidate()
        link?.close()
        link = nil
        route = ""
    }
}
