import Foundation
import UIKit

/// One of the event's recordings, as Browse lists it.
struct MediaItem: Identifiable, Equatable {
    let id: String
    let name: String
    let kind: String   // "video" or "audio"
    let mime: String
    let dur: Int       // ms
    let size: Int      // bytes
    /// What tvOS can play from a file: MP4 / QuickTime (phones record these), AAC, MP3, WAV. Not WebM.
    var playable: Bool {
        let m = mime.lowercased()
        return m.isEmpty || ["mp4", "quicktime", "x-m4a", "aac", "mpeg", "wav"].contains { m.contains($0) }
    }
    var fileExtension: String {
        let m = mime.lowercased()
        if m.contains("quicktime") { return "mov" }
        if m.contains("audio/mp4") || m.contains("x-m4a") || m.contains("aac") { return "m4a" }
        if m.contains("mpeg") { return "mp3" }
        if m.contains("wav") { return "wav" }
        return "mp4"
    }
}

/// The TV's side of the display protocol (docs/APPLE-TV.md), step for step the same as
/// public/js/tv.js: look the event up, join its signalling as a "display", say hello to the
/// studio, wait to be let in (Accept), offer a receive-only connection, and show
/// what the studio sends on it: the program, the event's recordings (Browse), the beacon, or the
/// event card. The studio chooses, or this TV does (Menu on the remote); PIP puts the live program
/// in a corner while browsing or beaconing.
@MainActor
final class DisplayClient: ObservableObject {
    enum Phase: Equatable {
        case join            // asking for the event code
        case looking         // event found, signalling opening
        case noStudio        // the studio isn't open
        case waitingAccept   // the studio hasn't let this TV in yet
        case connecting
        case program
        case browse          // the event's recordings
        case beacon          // the sync beacon, on the studio's clock
        case standby
        case unreachable     // can't reach the studio on this network
    }

    struct Fetching: Equatable { let id: String; let name: String; var got: Int; var size: Int }
    struct Playing: Identifiable, Equatable { let id: String; let name: String; let url: URL }

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
    @Published var pip = false                 // the program in a corner (browse, beacon)
    @Published var lag: Int?                   // this TV's display lag (ms), measured in the studio; nil: not yet
    @Published var items: [MediaItem] = []
    @Published var thumbs: [String: UIImage] = [:]
    @Published var fetching: Fetching?         // a recording coming over from the studio
    @Published var playing: Playing?           // the one on screen
    @Published var browseError = ""

    let renderer = SampleBufferRenderer()
    private(set) var eventId = ""
    private var server: Server?
    private var sock: MeshSocket?
    private var host: String?
    private var link: PeerLink?
    private var videoTrack: RTCVideoTrack? // (the one the renderer is on)
    private var pingTimer: Timer?
    private var iceTimer: Timer?
    private var lastPong = Date()
    private var seq = 0
    private var ctlOpen = false
    // the studio's clock: offset = studio − this TV, from the ping with the shortest round trip
    private var clockOff: Double = 0
    private var clockSamples: [(rtt: Double, off: Double)] = []
    // the recording coming in, written to a file as it arrives; and those already here
    private var rx: (id: String, size: Int, file: FileHandle, url: URL)?
    private var rxGot = 0 // (counted here; the progress bar hears about it every megabyte)
    private var cache: [(id: String, url: URL)] = []
    private static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }
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
            "caps": ["program", "browse", "beacon", "pip"], "screen": ["w": Int(b.width * scale), "h": Int(b.height * scale), "hdr": false],
        ]
        if let key { m["key"] = key }
        say(m)
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
            ctlOpen = true
            lastPong = Date()
            syncClock()
            pingTimer?.invalidate()
            pingTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if Date().timeIntervalSince(self.lastPong) > 15 {
                        self.message = "The studio stopped answering."
                        return self.restart()
                    }
                    self.ping()
                }
            }
        case .ctlMessage(let m):
            lastPong = Date()
            switch m["t"] as? String {
            case "mode": setMode(m["mode"] as? String ?? "idle", pip: m["pip"] as? Bool ?? false, params: m["params"] as? [String: Any] ?? [:])
            case "meta": if let t = m["title"] as? String, !t.isEmpty { title = t }
            case "pong": onPong(m)
            case "list": onList(m["items"] as? [[String: Any]] ?? [])
            case "thumb": onThumb(id: m["id"] as? String ?? "", data: m["data"] as? String ?? "")
            case "error":
                if (m["id"] as? String) == fetching?.id {
                    fetching = nil
                    browseError = m["message"] as? String ?? "The studio couldn’t send that one."
                }
            default: break
            }
        case .mediaMessage(let m):
            onMediaMessage(m)
        case .mediaData(let data):
            onMediaData(data)
        case .connected(let r):
            iceTimer?.invalidate()
            route = ["lan": "this network", "nat": "through the router", "relay": "relayed"][r] ?? ""
        case .failed:
            notReachable()
        case .videoTrack(let track):
            // (handed over twice, maybe in two wrappers of the same track: once is enough)
            guard track.trackId != videoTrack?.trackId else { return }
            videoTrack?.remove(renderer)
            videoTrack = track
            renderer.reset()
            track.add(renderer)
        }
    }

    private func setMode(_ mode: String, pip: Bool, params: [String: Any]) {
        let was = phase
        switch mode {
        case "program": phase = .program
        case "browse": phase = .browse
        case "beacon": phase = .beacon
        default: phase = .standby
        }
        self.pip = pip
        lag = (params["lag"] as? NSNumber)?.intValue
        if phase != .browse { closeClip() }
        if phase == .browse && was != .browse { link?.send(["t": "list"]) }
        if phase == .beacon && was != .beacon { syncClock() }
        state("active", ["mode": mode])
    }

    /// Ask the studio for a mode, or PIP, from this TV's remote (the studio answers with the mode).
    func want(_ mode: String, pip: Bool? = nil) {
        link?.send(["t": "want", "mode": mode, "pip": pip ?? self.pip])
    }
    var modeName: String {
        switch phase {
        case .program: return "program"
        case .browse: return "browse"
        case .beacon: return "beacon"
        default: return "idle"
        }
    }

    private func state(_ status: String, _ extra: [String: Any] = [:]) {
        var m: [String: Any] = ["t": "state", "status": status]
        m.merge(extra) { $1 }
        if ctlOpen { link?.send(m) } else { say(m) }
    }

    // MARK: the studio's clock (for the beacon)

    private func ping() {
        seq += 1
        link?.send(["t": "ping", "seq": seq, "at": Self.nowMs()])
    }
    private func syncClock() {
        for i in 0..<8 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.15) { [weak self] in self?.ping() }
        }
    }
    private func onPong(_ m: [String: Any]) {
        guard let at = (m["at"] as? NSNumber)?.doubleValue, let studio = (m["now"] as? NSNumber)?.doubleValue else { return }
        let t = Self.nowMs(), rtt = t - at
        guard rtt >= 0 else { return }
        clockSamples.append((rtt, studio + rtt / 2 - t))
        if clockSamples.count > 20 { clockSamples.removeFirst() }
        clockOff = clockSamples.min { $0.rtt < $1.rtt }?.off ?? 0
    }
    /// The studio's clock now, as this TV can best tell (ms since 1970).
    func studioNow() -> Double { Self.nowMs() + clockOff }
    /// The beacon's code: the join link with the clock in it, led by this TV's lag, as the studio's /beacon draws it.
    func beaconURL(at t: Double) -> String {
        var base = server?.base.absoluteString ?? serverBase
        while base.hasSuffix("/") { base.removeLast() }
        return "\(base)/cam?e=\(eventId)#t=\(Int64(t))"
    }
    var joinHost: String { server?.base.host ?? "vuemesh.com" }

    // MARK: Browse

    private func onList(_ list: [[String: Any]]) {
        items = list.compactMap { (x) -> MediaItem? in
            guard let id = x["id"] as? String else { return nil }
            return MediaItem(id: id, name: x["name"] as? String ?? "Recording", kind: x["kind"] as? String ?? "video", mime: x["mime"] as? String ?? "",
                             dur: (x["dur"] as? NSNumber)?.intValue ?? 0, size: (x["size"] as? NSNumber)?.intValue ?? 0)
        }
    }
    private func onThumb(id: String, data: String) {
        guard let comma = data.firstIndex(of: ","), let bytes = Data(base64Encoded: String(data[data.index(after: comma)...])),
              let img = UIImage(data: bytes) else { return }
        thumbs[id] = img
    }
    func refreshList() { link?.send(["t": "list"]) }

    /// Play a recording: from here if it's come over already, else ask the studio for it.
    func open(_ item: MediaItem) {
        browseError = ""
        guard item.playable else {
            browseError = "That one is WebM, which Apple TV can’t play. It plays on a screen with a browser at /tv."
            return
        }
        if let hit = cache.first(where: { $0.id == item.id }) { return play(item, url: hit.url) }
        if let f = fetching, f.id != item.id { link?.send(["t": "cancel", "id": f.id]) }
        closeRx()
        fetching = Fetching(id: item.id, name: item.name, got: 0, size: item.size)
        link?.send(["t": "get", "id": item.id])
    }

    private func onMediaMessage(_ m: [String: Any]) {
        guard let id = m["id"] as? String else { return }
        switch m["t"] as? String {
        case "file":
            guard id == fetching?.id, let item = items.first(where: { $0.id == id }) else { return }
            closeRx()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("vm-\(id.filter { $0.isLetter || $0.isNumber }.prefix(40)).\(item.fileExtension)")
            try? FileManager.default.removeItem(at: url)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            guard let fh = try? FileHandle(forWritingTo: url) else {
                fetching = nil
                browseError = "There’s no room on this Apple TV for that recording."
                return
            }
            let size = (m["size"] as? NSNumber)?.intValue ?? item.size
            rx = (id, size, fh, url)
            rxGot = 0
            fetching?.size = size
        case "end":
            guard let r = rx, r.id == id else { return }
            try? r.file.close()
            rx = nil
            fetching = nil
            cache.append((id, r.url))
            // keep the last few here (an Apple TV hasn't room for many)
            while cache.count > 6 {
                let old = cache.removeFirst()
                if old.id != playing?.id { try? FileManager.default.removeItem(at: old.url) }
            }
            if let item = items.first(where: { $0.id == id }) { play(item, url: r.url) }
        default:
            break
        }
    }
    private func onMediaData(_ data: Data) {
        guard let r = rx else { return }
        do { try r.file.write(contentsOf: data) } catch {
            closeRx()
            fetching = nil
            browseError = "There’s no room on this Apple TV for that recording."
            return
        }
        rxGot += data.count
        if rxGot - (fetching?.got ?? 0) >= 1 << 20 { fetching?.got = rxGot }
    }
    private func closeRx() {
        if let r = rx {
            try? r.file.close()
            try? FileManager.default.removeItem(at: r.url)
        }
        rx = nil
    }

    private func play(_ item: MediaItem, url: URL) {
        playing = Playing(id: item.id, name: item.name, url: url)
    }
    func closeClip() { playing = nil }

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
        ctlOpen = false
        closeRx()
        fetching = nil
        pingTimer?.invalidate()
        iceTimer?.invalidate()
        videoTrack?.remove(renderer)
        videoTrack = nil
        link?.close()
        link = nil
        route = ""
    }
}
