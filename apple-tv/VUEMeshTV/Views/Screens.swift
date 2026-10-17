import SwiftUI

struct RootView: View {
    @EnvironmentObject var client: DisplayClient

    var body: some View {
        ZStack {
            Theme.black.ignoresSafeArea()
            switch client.phase {
            case .join: JoinScreen()
            case .program: ProgramScreen()
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
    @State private var entering = false

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
            if entering && client.phase == .waitingAccept {
                CodeEntry(length: 8, cellSize: 96, bad: client.codeError) { client.pair($0) }
            }
            Text(client.message).font(Theme.body(28)).foregroundStyle(Theme.error).frame(minHeight: 36)
            if client.phase != .standby {
                HStack(spacing: 24) {
                    if client.phase == .waitingAccept && !entering {
                        LinkButton(title: "Enter a TV code") { entering = true }
                    }
                    LinkButton(title: "Another event") { entering = false; client.leave() }
                }
            }
        }
        .padding(60)
        .onExitCommand { if entering { entering = false } else { client.leave() } }
    }
}

// MARK: program

struct ProgramScreen: View {
    @EnvironmentObject var client: DisplayClient
    @State private var labelShown = true
    @State private var menu = false
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
            }
            .padding(.horizontal, 22).padding(.vertical, 12)
            .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 8))
            .padding(60)
            .opacity(labelShown ? 1 : 0)
            .animation(.easeOut(duration: 0.6), value: labelShown)
            if menu {
                VStack(spacing: 20) {
                    LinkButton(title: "Keep watching") { menu = false; showLabel() }
                    LinkButton(title: "Another event") { menu = false; client.leave() }
                }
                .padding(40)
                .background(Theme.surface.opacity(0.95), in: RoundedRectangle(cornerRadius: 16))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .focusable(!menu)
        .onMoveCommand { _ in showLabel() }
        .onPlayPauseCommand { showLabel() }
        .onExitCommand { if menu { menu = false } else { menu = true } }
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

struct VideoLayer: UIViewRepresentable {
    let renderer: SampleBufferRenderer
    func makeUIView(context: Context) -> VideoLayerView { VideoLayerView(renderer: renderer) }
    func updateUIView(_ view: VideoLayerView, context: Context) {}
}
