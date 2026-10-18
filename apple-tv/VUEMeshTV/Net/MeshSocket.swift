import Foundation

/// The event's signalling socket, the same as meshSocket in vm.js: the same query string, hello on
/// open, a ping every 4 minutes (API Gateway drops idle sockets at 10), and backoff from 1 s,
/// doubling to 15 s, when it closes. Callbacks arrive on the main queue.
final class MeshSocket: NSObject, URLSessionWebSocketDelegate {
    struct Peer {
        let peer: String
        let role: String
        let name: String
    }

    let peer = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
    var onPeers: (([Peer]) -> Void)?
    var onSignal: ((_ from: String, _ data: [String: Any]) -> Void)?

    private let url: URL
    private var task: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var delay: TimeInterval = 1
    private var pingTimer: Timer?
    private var closed = false

    init(ws: URL, eventId: String, name: String, cid: String) {
        var c = URLComponents(url: ws, resolvingAgainstBaseURL: false)!
        c.queryItems = [
            URLQueryItem(name: "e", value: eventId), URLQueryItem(name: "role", value: "display"),
            URLQueryItem(name: "peer", value: peer), URLQueryItem(name: "name", value: name), URLQueryItem(name: "cid", value: cid),
        ]
        url = c.url!
        super.init()
    }

    func open() {
        closed = false
        task = session.webSocketTask(with: url)
        task?.resume()
        receive()
    }

    func close() {
        closed = true
        pingTimer?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
    }

    func send(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }

    func signal(_ to: String, _ data: [String: Any]) {
        send(["action": "signal", "to": to, "data": data])
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                return // (didClose / didCompleteWithError reconnects)
            case .success(let message):
                if case .string(let s) = message, let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] {
                    DispatchQueue.main.async { self.handle(obj) }
                }
                self.receive()
            }
        }
    }

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "peers":
            let peers = (msg["peers"] as? [[String: Any]] ?? []).map {
                Peer(peer: $0["peer"] as? String ?? "", role: $0["role"] as? String ?? "", name: $0["name"] as? String ?? "")
            }
            onPeers?(peers)
        case "signal":
            if let from = msg["from"] as? String, let data = msg["data"] as? [String: Any] { onSignal?(from, data) }
        default:
            break
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        delay = 1
        send(["action": "hello"])
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 240, repeats: true) { [weak self] _ in self?.send(["action": "ping"]) }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        retry(after: webSocketTask)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        retry(after: task)
    }

    /// One reconnect per lost socket (a close can be reported twice).
    private func retry(after ended: URLSessionTask) {
        guard ended === task else { return }
        task = nil
        pingTimer?.invalidate()
        guard !closed else { return }
        delay = min(delay * 2, 15)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, !self.closed else { return }
            self.open()
        }
    }
}
