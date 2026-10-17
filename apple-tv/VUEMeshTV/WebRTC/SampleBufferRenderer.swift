import AVFoundation
import UIKit

/// Draws the program's frames with AVSampleBufferDisplayLayer, which tvOS supports directly.
/// The studio sends H.264 first, which tvOS decodes in hardware (VideoToolbox), so frames arrive as
/// CVPixelBuffers and go straight to the layer with no copy.
final class SampleBufferRenderer: NSObject, RTCVideoRenderer {
    let layer = AVSampleBufferDisplayLayer()
    private var format: CMVideoFormatDescription?
    private var formatSize = CGSize.zero
    private var warnedSoftware = false
    var onFirstFrame: (() -> Void)?
    private var sawFrame = false

    override init() {
        super.init()
        layer.videoGravity = .resizeAspect
        layer.backgroundColor = UIColor.black.cgColor
    }

    func setSize(_ size: CGSize) {}

    func renderFrame(_ frame: RTCVideoFrame?) {
        guard let frame else { return }
        guard let pixelBuffer = (frame.buffer as? RTCCVPixelBuffer)?.pixelBuffer else {
            // A software-decoded frame (VP8 or VP9): the studio asks for H.264 first, so this means
            // the studio's browser couldn't send it. Logged once; nothing is drawn.
            if !warnedSoftware {
                warnedSoftware = true
                NSLog("VUEMesh TV: the program isn't H.264; this build only draws hardware-decoded frames")
            }
            return
        }
        let size = CGSize(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
        if format == nil || size != formatSize {
            var desc: CMVideoFormatDescription?
            CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer, formatDescriptionOut: &desc)
            format = desc
            formatSize = size
        }
        guard let format else { return }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample)
        guard let sample else { return }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dict, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if #available(tvOS 17.0, *) {
                if self.layer.sampleBufferRenderer.status == .failed { self.layer.sampleBufferRenderer.flush() }
                self.layer.sampleBufferRenderer.enqueue(sample)
            } else {
                if self.layer.status == .failed { self.layer.flush() }
                self.layer.enqueue(sample)
            }
            if !self.sawFrame {
                self.sawFrame = true
                self.onFirstFrame?()
            }
        }
    }

    func reset() {
        sawFrame = false
        if #available(tvOS 17.0, *) { layer.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil) } else { layer.flushAndRemoveImage() }
    }
}

/// Hosts the renderer's layer in SwiftUI.
final class VideoLayerView: UIView {
    let renderer: SampleBufferRenderer
    init(renderer: SampleBufferRenderer) {
        self.renderer = renderer
        super.init(frame: .zero)
        backgroundColor = .black
        layer.addSublayer(renderer.layer)
    }
    required init?(coder: NSCoder) { fatalError("not used") }
    override func layoutSubviews() {
        super.layoutSubviews()
        renderer.layer.frame = bounds
    }
}
