// The one place that names the WebRTC framework. LiveKit's build (Swift package
// https://github.com/livekit/webrtc-xcframework, product LiveKitWebRTC) supports tvOS and prefixes
// every class with LKRTC. To use another build (stasel/WebRTC uses plain RTC), change the import and
// these aliases; nothing else in the app names the framework.

import LiveKitWebRTC

typealias RTCPeerConnectionFactory = LKRTCPeerConnectionFactory
typealias RTCPeerConnection = LKRTCPeerConnection
typealias RTCPeerConnectionDelegate = LKRTCPeerConnectionDelegate
typealias RTCConfiguration = LKRTCConfiguration
typealias RTCIceServer = LKRTCIceServer
typealias RTCIceCandidate = LKRTCIceCandidate
typealias RTCSessionDescription = LKRTCSessionDescription
typealias RTCMediaConstraints = LKRTCMediaConstraints
typealias RTCMediaStream = LKRTCMediaStream
typealias RTCRtpReceiver = LKRTCRtpReceiver
typealias RTCRtpTransceiver = LKRTCRtpTransceiver
typealias RTCRtpTransceiverInit = LKRTCRtpTransceiverInit
typealias RTCDataChannel = LKRTCDataChannel
typealias RTCDataChannelDelegate = LKRTCDataChannelDelegate
typealias RTCDataChannelConfiguration = LKRTCDataChannelConfiguration
typealias RTCDataBuffer = LKRTCDataBuffer
typealias RTCVideoTrack = LKRTCVideoTrack
typealias RTCVideoRenderer = LKRTCVideoRenderer
typealias RTCVideoFrame = LKRTCVideoFrame
typealias RTCCVPixelBuffer = LKRTCCVPixelBuffer
typealias RTCDefaultVideoDecoderFactory = LKRTCDefaultVideoDecoderFactory
typealias RTCDefaultVideoEncoderFactory = LKRTCDefaultVideoEncoderFactory
typealias RTCSignalingState = LKRTCSignalingState
typealias RTCIceConnectionState = LKRTCIceConnectionState
typealias RTCIceGatheringState = LKRTCIceGatheringState
typealias RTCPeerConnectionState = LKRTCPeerConnectionState
typealias RTCSdpType = LKRTCSdpType
typealias RTCRtpMediaType = LKRTCRtpMediaType
