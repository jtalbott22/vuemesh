import AVFoundation
import UIKit

/// Draws the program's frames with AVSampleBufferDisplayLayer, which tvOS supports directly.
/// The studio asks for H.264 first, which tvOS decodes in hardware (VideoToolbox): those frames
/// arrive as CVPixelBuffers and go straight to the layer with no copy. Anything else (VP8 or VP9,
/// when the studio's browser can't send H.264, or H.264 the hardware didn't take) arrives decoded
/// in software as I420, and is copied into a pixel buffer the layer can show. It used to be dropped,
/// which left the TV with the program's sound over a black screen.
final class SampleBufferRenderer: NSObject, RTCVideoRenderer {
    let layer = AVSampleBufferDisplayLayer()
    private var format: CMVideoFormatDescription?
    private var formatSize = CGSize.zero
    private var pool: CVPixelBufferPool?
    private var poolSize = CGSize.zero
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
        let hardware = (frame.buffer as? RTCCVPixelBuffer)?.pixelBuffer
        if hardware == nil && !warnedSoftware {
            warnedSoftware = true
            NSLog("VUEMesh TV: the program is decoded in software (not hardware H.264); copying its frames")
        }
        guard let pixelBuffer = hardware ?? copyToPixelBuffer(frame) else { return }
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

    /// A software-decoded frame (I420: three planes) into a bi-planar NV12 pixel buffer, from a pool.
    private func copyToPixelBuffer(_ frame: RTCVideoFrame) -> CVPixelBuffer? {
        let i420 = frame.buffer.toI420()
        let w = Int(i420.width), h = Int(i420.height)
        guard w > 0, h > 0 else { return nil }
        if pool == nil || poolSize != CGSize(width: w, height: h) {
            let attrs: [CFString: Any] = [
                kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                kCVPixelBufferWidthKey: w,
                kCVPixelBufferHeightKey: h,
                kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
            ]
            var p: CVPixelBufferPool?
            CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &p)
            pool = p
            poolSize = CGSize(width: w, height: h)
        }
        guard let pool else { return nil }
        var made: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &made)
        guard let out = made else { return nil }
        CVPixelBufferLockBaseAddress(out, [])
        defer { CVPixelBufferUnlockBaseAddress(out, []) }
        guard let yBase = CVPixelBufferGetBaseAddressOfPlane(out, 0), let uvBase = CVPixelBufferGetBaseAddressOfPlane(out, 1) else { return nil }
        // luma: row by row (the strides differ)
        let yDst = yBase.assumingMemoryBound(to: UInt8.self), yDstStride = CVPixelBufferGetBytesPerRowOfPlane(out, 0)
        let ySrc = i420.dataY, ySrcStride = Int(i420.strideY)
        for row in 0..<h { memcpy(yDst + row * yDstStride, ySrc + row * ySrcStride, w) }
        // chroma: U and V side by side (CbCr) in one plane
        let uvDst = uvBase.assumingMemoryBound(to: UInt8.self), uvDstStride = CVPixelBufferGetBytesPerRowOfPlane(out, 1)
        let cw = Int(i420.chromaWidth), ch = Int(i420.chromaHeight)
        let u = i420.dataU, v = i420.dataV, uStride = Int(i420.strideU), vStride = Int(i420.strideV)
        for row in 0..<ch {
            let d = uvDst + row * uvDstStride, ur = u + row * uStride, vr = v + row * vStride
            for x in 0..<cw {
                d[2 * x] = ur[x]
                d[2 * x + 1] = vr[x]
            }
        }
        return out
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
