import SwiftUI
import AVKit
import CoreImage.CIFilterBuiltins

struct RootView: View {
    @EnvironmentObject var client: DisplayClient

    var body: some View {
        ZStack {
            Theme.black.ignoresSafeArea()
            switch client.phase {
            case .join: JoinScreen()
            case .program, .browse, .beacon: ShowScreen()
            default: WaitScreen()
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: join

struct JoinScreen: View {
    @EnvironmentObject var client: DisplayClient
    @State private var settings = false

    var body: some View {
        VStack(spacing: 40) {
            Mark()
            Text("Show an event on this screen")
                .font(Theme.display(96)).foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
            Text("Enter the event code. It’s on the studio and on every beacon.")
                .font(Theme.body(32)).foregroundStyle(Theme.text2)
            CodeEntry(length: 6, bad: client.codeError) { code in
                Task { await client.join(code) }
            }
            Text(client.message).font(Theme.body(28)).foregroundStyle(Theme.error).frame(minHeight: 36)
            HStack(spacing: 24) {
                LinkButton(title: "This screen: \(client.screenName)") { settings = true }
            }
        }
        .padding(60)
        .sheet(isPresented: $settings) { SettingsSheet() }
    }
}

struct SettingsSheet: View {
    @EnvironmentObject var client: DisplayClient
    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            Text("This screen").font(Theme.display(64)).foregroundStyle(Theme.text)
            TextField("Name the studio sees", text: $client.screenName)
            Text("VUEMesh server").font(Theme.label(34)).foregroundStyle(Theme.text2)
            TextField("https://vuemesh.com", text: $client.serverBase)
                .textContentType(.URL)
            Text("To test with the dev server, use http://<laptop address>:8790.")
                .font(Theme.body(26)).foregroundStyle(Theme.text2)
        }
        .padding(80)
        .frame(maxWidth: 1100)
    }
}

// MARK: waiting, standby, can't connect

struct WaitScreen: View {
    @EnvironmentObject var client: DisplayClient

    private var say: String {
        switch client.phase {
        case .looking: return "Looking for the studio…"
        case .noStudio: return "Waiting for the studio. Open the VUEMesh studio for this event."
        case .waitingAccept: return "Waiting for the studio to accept this screen. It shows up under TV screens."
        case .connecting: return "Connecting to the studio…"
        case .standby: return "The studio has this screen on standby."
        case .unreachable: return "This screen can’t reach the studio. Put both on the same Wi-Fi, or plug the Apple TV into the studio’s router."
        default: return ""
        }
    }

    var body: some View {
        VStack(spacing: 40) {
            Mark()
            Text(client.title.isEmpty ? client.eventId : client.title)
                .font(Theme.display(client.phase == .standby ? 140 : 110)).foregroundStyle(Theme.text)
                .multilineTextAlignment(.center).lineLimit(3).minimumScaleFactor(0.5)
            Text(say).font(Theme.body(34)).foregroundStyle(Theme.text2)
                .multilineTextAlignment(.center).frame(maxWidth: 1300)
            Text(client.message).font(Theme.body(28)).foregroundStyle(Theme.error).frame(minHeight: 36)
            if client.phase == .standby {
                // on the event card, this TV can still choose what to show
                HStack(spacing: 22) {
                    ModeButton(title: "Program", on: false) { client.want("program") }
                    ModeButton(title: "Browse recordings", on: false) { client.want("browse") }
                    ModeButton(title: "Beacon", on: false) { client.want("beacon") }
                }
            } else {
                LinkButton(title: "Another event") { client.leave() }
            }
        }
        .padding(60)
        .onExitCommand { client.leave() }
    }
}

// MARK: what the studio sends: the program, Browse, the beacon; and the mode menu

/// The modes, PIP and the menu that switches between them (Menu on the remote, from anywhere).
struct ShowScreen: View {
    @EnvironmentObject var client: DisplayClient
    @State private var menu = false

    var body: some View {
        ZStack {
            Group {
                switch client.phase {
                case .browse: BrowseView()
                case .beacon: BeaconView()
                default: ProgramView()
                }
            }
            .disabled(menu || client.playing != nil) // (so focus goes to the menu, or the player, while it's up)
            if let p = client.playing { ClipPlayer(playing: p).disabled(menu) }
            if client.pip && (client.phase == .browse || client.phase == .beacon) { PipView() }
            if menu { ModeMenu { menu = false } }
        }
        .onExitCommand {
            if client.playing != nil { client.closeClip() } else { menu.toggle() }
        }
    }
}

/// Program, Browse, Beacon, PIP, or another event. The studio hears what's chosen and remembers it.
struct ModeMenu: View {
    @EnvironmentObject var client: DisplayClient
    let close: () -> Void
    private enum Choice: Hashable { case program, browse, beacon, pip }
    @FocusState private var focus: Choice?

    /// Where focus starts: the mode on screen now.
    private var current: Choice {
        switch client.phase {
        case .browse: return .browse
        case .beacon: return .beacon
        default: return .program
        }
    }

    var body: some View {
        VStack(spacing: 22) {
            Text("Show").font(Theme.label(34)).foregroundStyle(Theme.text2)
            HStack(spacing: 22) {
                ModeButton(title: "Program", on: client.phase == .program) { pick("program") }
                    .focused($focus, equals: .program)
                ModeButton(title: "Browse recordings", on: client.phase == .browse) { pick("browse") }
                    .focused($focus, equals: .browse)
                ModeButton(title: "Beacon", on: client.phase == .beacon) { pick("beacon") }
                    .focused($focus, equals: .beacon)
            }
            if client.phase == .browse || client.phase == .beacon {
                ModeButton(title: client.pip ? "PIP: on" : "PIP: off", on: client.pip) {
                    client.want(client.modeName, pip: !client.pip)
                }
                .focused($focus, equals: .pip)
            }
            if !client.studioModes {
                Text("This studio runs an older VUEMesh: Browse, Beacon and PIP need the studio updated to 0.51 or later.")
                    .font(Theme.body(26)).foregroundStyle(Theme.error).multilineTextAlignment(.center).frame(maxWidth: 900)
            }
            LinkButton(title: "Another event") { close(); client.leave() }
        }
        .padding(50)
        .background(Theme.surface.opacity(0.96), in: RoundedRectangle(cornerRadius: 18))
        .focusSection()
        .defaultFocus($focus, current)
        // (the menu appears over something that had focus: move it here, or nothing can be chosen)
        .onAppear { DispatchQueue.main.async { focus = current } }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.35).ignoresSafeArea())
    }

    private func pick(_ mode: String) {
        client.want(mode)
        close()
    }
}

/// A button in the mode menu: amber when focused, a light outline when it's the current one.
struct ModeButton: View {
    let title: String
    let on: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) { Text(title) }
            .buttonStyle(ModeButtonStyle(on: on))
    }
}

/// Draws its own focus (read from the button itself, so it's right however focus got there).
struct ModeButtonStyle: ButtonStyle {
    let on: Bool
    func makeBody(configuration: Configuration) -> some View {
        Face(label: configuration.label, on: on, pressed: configuration.isPressed)
    }
    private struct Face<Label: View>: View {
        let label: Label
        let on: Bool
        let pressed: Bool
        @Environment(\.isFocused) private var focused
        var body: some View {
            label.font(Theme.label(36))
                .foregroundStyle(focused ? Theme.black : Theme.text)
                .padding(.horizontal, 34).padding(.vertical, 18)
                .background(focused ? Theme.amber : Theme.cell, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Theme.text : .clear, lineWidth: 3))
                .scaleEffect(focused ? 1.06 : 1)
                .opacity(pressed ? 0.8 : 1)
                .animation(.easeOut(duration: 0.15), value: focused)
        }
    }
}

// MARK: program

struct ProgramView: View {
    @EnvironmentObject var client: DisplayClient
    @State private var labelShown = true
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            VideoLayer(renderer: client.renderer).ignoresSafeArea()
            // the under-monitor label: what's on this screen, and that it's live
            HStack(spacing: 16) {
                Circle().fill(Theme.tally).frame(width: 22, height: 22).shadow(color: Theme.tally, radius: 12)
                Text(client.title).font(Theme.label(36)).foregroundStyle(Theme.text)
                if !client.route.isEmpty {
                    Text(client.route).font(Theme.label(30)).foregroundStyle(Theme.text2)
                }
                Text("Menu: Browse, Beacon").font(Theme.label(26)).foregroundStyle(Theme.text2)
            }
            .padding(.horizontal, 22).padding(.vertical, 12)
            .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 8))
            .padding(60)
            .opacity(labelShown ? 1 : 0)
            .animation(.easeOut(duration: 0.6), value: labelShown)
        }
        .focusable()
        .onMoveCommand { _ in showLabel() }
        .onPlayPauseCommand { showLabel() }
        .onAppear { showLabel() }
    }

    private func showLabel() {
        labelShown = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { labelShown = false }
        }
    }
}

/// The live program small in a corner, over the recordings or the beacon (picture only).
struct PipView: View {
    @EnvironmentObject var client: DisplayClient
    var body: some View {
        VideoLayer(renderer: client.renderer)
            .frame(width: 576, height: 324)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.tally, lineWidth: 4))
            .padding(60)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .allowsHitTesting(false)
    }
}

// MARK: Browse: the event's recordings, pulled from the studio over the local network

struct BrowseView: View {
    @EnvironmentObject var client: DisplayClient
    private let columns = [GridItem(.adaptive(minimum: 400), spacing: 48)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                HStack(alignment: .firstTextBaseline, spacing: 30) {
                    Text("Recordings").font(Theme.display(80)).foregroundStyle(Theme.text)
                    LinkButton(title: "Refresh") { client.refreshList() }
                }
                Text(client.browseError).font(Theme.body(28)).foregroundStyle(Theme.error)
                if client.items.isEmpty {
                    Text("No recordings yet. They show up here as they reach the studio.")
                        .font(Theme.body(32)).foregroundStyle(Theme.text2)
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 48) {
                    ForEach(client.items) { item in
                        ItemCard(item: item, thumb: client.thumbs[item.id]) { client.open(item) }
                    }
                }
            }
            .padding(80)
        }
        .overlay(alignment: .bottom) {
            if let f = client.fetching {
                VStack(alignment: .leading, spacing: 12) {
                    Text(f.name).font(Theme.label(32)).foregroundStyle(Theme.text)
                    ProgressView(value: Double(f.got), total: Double(max(f.size, 1))).tint(Theme.amber)
                    Text("\(f.got / 1_000_000) of \(max(f.size, 1) / 1_000_000) MB from the studio").font(Theme.body(24)).foregroundStyle(Theme.text2)
                }
                .padding(30)
                .frame(width: 900)
                .background(Theme.surface.opacity(0.96), in: RoundedRectangle(cornerRadius: 14))
                .padding(60)
            }
        }
    }
}

struct ItemCard: View {
    let item: MediaItem
    let thumb: UIImage?
    let action: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    Rectangle().fill(Color.black)
                    if let thumb {
                        Image(uiImage: thumb).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Text(item.kind == "audio" ? "MIC" : "").font(Theme.display(48)).foregroundStyle(Theme.text2)
                    }
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                Text(item.name).font(Theme.label(32)).foregroundStyle(focused ? Theme.black : Theme.text).lineLimit(1)
                Text(item.playable ? "\(Self.duration(item.dur)) · \(max(1, item.size / 1_000_000)) MB" : "WebM: plays in a browser at /tv")
                    .font(Theme.body(22)).foregroundStyle(focused ? Theme.black : Theme.text2)
            }
            .padding(14)
            .background(focused ? Theme.amber : Theme.surface, in: RoundedRectangle(cornerRadius: 12))
            .opacity(item.playable ? 1 : 0.55)
        }
        .buttonStyle(QuietButtonStyle())
        .focused($focused)
        .scaleEffect(focused ? 1.05 : 1)
        .zIndex(focused ? 1 : 0)
        .animation(.easeOut(duration: 0.15), value: focused)
    }

    static func duration(_ ms: Int) -> String {
        let s = ms / 1000
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// A recording, full screen with the system's playback controls. Menu goes back to the list.
struct ClipPlayer: View {
    @EnvironmentObject var client: DisplayClient
    let playing: DisplayClient.Playing
    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .ignoresSafeArea()
            .onAppear {
                let p = AVPlayer(url: playing.url)
                player = p
                p.play()
            }
            .onDisappear { player?.pause() }
            .onChange(of: playing) { _, now in
                player?.replaceCurrentItem(with: AVPlayerItem(url: now.url))
                player?.play()
            }
            .onExitCommand { client.closeClip() }
    }
}

// MARK: Beacon: phones sync to it, on the studio's clock, led by this TV's lag

struct BeaconView: View {
    @EnvironmentObject var client: DisplayClient
    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    var body: some View {
        // (15 codes a second, as /beacon: slower than the screen, so a phone's camera catches whole ones)
        TimelineView(.periodic(from: .now, by: 1.0 / 15)) { _ in
            let t = client.studioNow() + Double(client.lag ?? 0)
            HStack(spacing: 90) {
                QRCode(text: client.beaconURL(at: t))
                    .frame(width: 900, height: 900)
                VStack(alignment: .leading, spacing: 26) {
                    Text(client.title).font(Theme.display(96)).foregroundStyle(Color.black).lineLimit(3).minimumScaleFactor(0.5)
                    Text(Self.clock.string(from: Date(timeIntervalSince1970: t / 1000)))
                        .font(Theme.display(110)).monospacedDigit().foregroundStyle(Color.black)
                    Text("Scan to join. Your phone syncs to this screen once, and then every clip lines up by itself.")
                        .font(Theme.body(32)).foregroundStyle(Color(white: 0.27))
                    Text("Or go to \(client.joinHost)/cam and enter \(client.eventId)")
                        .font(Theme.body(30)).foregroundStyle(Color(white: 0.27))
                    if client.lag == nil {
                        Text("Turn on this TV’s Game mode, then Calibrate it in the studio (TV screens), so phones synced here line up exactly.")
                            .font(Theme.body(28)).foregroundStyle(Color(red: 0.54, green: 0.35, blue: 0))
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white)
        }
        .ignoresSafeArea()
        .focusable()
    }
}

/// A QR code, drawn with hard edges so a phone across the room reads it.
struct QRCode: View {
    let text: String
    private static let context = CIContext()

    var body: some View {
        if let img = Self.image(text) {
            Image(uiImage: img).interpolation(.none).resizable().aspectRatio(1, contentMode: .fit)
        } else {
            Color.white
        }
    }

    static func image(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "L" // (the beacon's level: bigger modules, read from further)
        // (the quiet zone round it is the beacon's white page)
        guard let out = f.outputImage, let cg = context.createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

struct VideoLayer: UIViewRepresentable {
    let renderer: SampleBufferRenderer
    func makeUIView(context: Context) -> VideoLayerView { VideoLayerView(renderer: renderer) }
    func updateUIView(_ view: VideoLayerView, context: Context) {}
}
