import Foundation

/// The TV's one connection to the studio: receive-only picture and sound, plus a reliable "ctl"
/// data channel for mode, meta and ping. The TV makes the offer, as cameras do; the studio answers
/// and puts the program on it (docs/APPLE-TV.md, Join flow steps 5 to 7).
///
/// WebRTC calls back on its own threads; every event is handed to `events` on the main queue.
final class PeerLink: NSObject {
    enum Event {
        case offer(sdp: String)
        case ice(candidate: String, sdpMid: String?, sdpMLineIndex: Int32)
        case ctlOpen
        case ctlMessage([String: Any])
        case connected(route: String)
        case failed
        case videoTrack(RTCVideoTrack)
    }

    private static let factory: RTCPeerConnectionFactory = {
        RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
    }()

    private var pc: RTCPeerConnection?
    private var ctl: RTCDataChannel?
    private var pendingIce: [RTCIceCandidate] = []
    private var remoteSet = false
    private let events: (Event) -> Void

    init(stunURLs: [String], events: @escaping (Event) -> Void) {
        self.events = events
        super.init()
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        // Public STUN only, no TURN: the picture stays on the local network (vm.js ICE).
        config.iceServers = [RTCIceServer(urlStrings: stunURLs)]
        config.continualGatheringPolicy = .gatherContinually
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self)

        let recvOnly = RTCRtpTransceiverInit()
        recvOnly.direction = .recvOnly
        pc?.addTransceiver(of: .video, init: recvOnly)
        pc?.addTransceiver(of: .audio, init: recvOnly)

        let cfg = RTCDataChannelConfiguration()
        cfg.isOrdered = true
        ctl = pc?.dataChannel(forLabel: "ctl", configuration: cfg)
        ctl?.delegate = self
    }

    func makeOffer() {
        guard let pc else { return }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc.offer(for: constraints) { [weak self] sdp, error in
            guard let self else { return }
            guard let sdp, error == nil else {
                self.emit(.failed)
                return
            }
            pc.setLocalDescription(sdp) { [weak self] error in
                guard let self else { return }
                if error != nil { self.emit(.failed) } else { self.emit(.offer(sdp: sdp.sdp)) }
            }
        }
    }

    func setAnswer(_ sdp: String) {
        let desc = RTCSessionDescription(type: .answer, sdp: sdp)
        pc?.setRemoteDescription(desc) { [weak self] error in
            guard let self, error == nil else { return }
            self.remoteSet = true
            for c in self.pendingIce { self.pc?.add(c) { _ in } }
            self.pendingIce.removeAll()
            // The picture's track is there once the answer is in; don't rely on didAdd(rtpReceiver:)
            // alone to hand it over (DisplayClient attaches a track only once).
            for t in self.pc?.transceivers ?? [] where t.mediaType == .video {
                if let video = t.receiver.track as? RTCVideoTrack { self.emit(.videoTrack(video)) }
            }
        }
    }

    func addIce(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        let c = RTCIceCandidate(sdp: candidate, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        if remoteSet { pc?.add(c) { _ in } } else { pendingIce.append(c) }
    }

    func send(_ obj: [String: Any]) {
        guard let ctl, ctl.readyState == .open,
              let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        ctl.sendData(RTCDataBuffer(data: data, isBinary: false))
    }

    func close() {
        ctl?.close()
        pc?.close()
        ctl = nil
        pc = nil
    }

    private func emit(_ e: Event) {
        DispatchQueue.main.async { self.events(e) }
    }

    /// Judge the chosen path from the selected candidate pair, as pathOf in rtc.js does:
    /// host-to-host is this network; anything through a relay or a public address is not.
    private func reportRoute() {
        pc?.statistics { [weak self] report in
            var pairLocal: String?, pairRemote: String?
            var types: [String: String] = [:]
            for (_, s) in report.statistics {
                if s.type == "candidate-pair", (s.values["state"] as? String) == "succeeded", (s.values["nominated"] as? NSNumber)?.boolValue == true {
                    pairLocal = s.values["localCandidateId"] as? String
                    pairRemote = s.values["remoteCandidateId"] as? String
                }
                if s.type == "local-candidate" || s.type == "remote-candidate" {
                    types[s.id] = s.values["candidateType"] as? String
                }
            }
            let lt = pairLocal.flatMap { types[$0] }, rt = pairRemote.flatMap { types[$0] }
            let route: String
            if lt == "relay" || rt == "relay" { route = "relay" }
            else if lt == "host" && rt == "host" { route = "lan" }
            else if lt == "prflx" || rt == "prflx" { route = "lan" }
            else if lt == nil { route = "unknown" }
            else { route = "nat" }
            self?.emit(.connected(route: route))
        }
    }
}

extension PeerLink: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        emit(.ice(candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex))
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        switch newState {
        case .connected: reportRoute()
        case .failed: emit(.failed)
        default: break
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
        if let video = rtpReceiver.track as? RTCVideoTrack { emit(.videoTrack(video)) }
        // Sound plays through WebRTC's own audio output as soon as its track arrives.
    }
}

extension PeerLink: RTCDataChannelDelegate {
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        if dataChannel.readyState == .open { emit(.ctlOpen) }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary,
              let obj = try? JSONSerialization.jsonObject(with: buffer.data) as? [String: Any] else { return }
        emit(.ctlMessage(obj))
    }
}
