import SwiftUI

/// VUEMesh's broadcast vernacular on a TV: monitor black, tally red for on air, amber for the
/// focused control, and Barlow Condensed for anything read from across a room (the site's faces).
enum Theme {
    static let black = Color.black
    static let surface = Color(red: 0x18 / 255, green: 0x19 / 255, blue: 0x1d / 255)
    static let cell = Color(red: 0x12 / 255, green: 0x13 / 255, blue: 0x16 / 255)
    static let line = Color(red: 0x2d / 255, green: 0x2f / 255, blue: 0x35 / 255)
    static let text = Color(red: 0xec / 255, green: 0xec / 255, blue: 0xef / 255)
    static let text2 = Color(red: 0xa9 / 255, green: 0xac / 255, blue: 0xb4 / 255)
    static let tally = Color(red: 0xd9 / 255, green: 0x30 / 255, blue: 0x25 / 255)
    static let amber = Color(red: 0xf0 / 255, green: 0xa8 / 255, blue: 0x2b / 255)
    static let error = Color(red: 1, green: 0x8a / 255, blue: 0x80 / 255)

    static func display(_ size: CGFloat) -> Font { .custom("BarlowCondensed-ExtraBold", size: size) }
    static func label(_ size: CGFloat) -> Font { .custom("BarlowCondensed-SemiBold", size: size) }
    static func body(_ size: CGFloat) -> Font { .custom("Barlow-Medium", size: size) }
}

/// The wordmark: a tally lamp and the name.
struct Mark: View {
    var body: some View {
        HStack(spacing: 14) {
            Circle().fill(Theme.tally).frame(width: 22, height: 22)
            Text("VUEMesh").font(Theme.display(40)).foregroundStyle(Theme.text2)
        }
    }
}

/// A button that draws its own focus (amber, a little larger) and nothing else. tvOS's .plain style
/// still adds the system's focus platter, a light rounded slab behind the button, which spilled over
/// the keys either side of the focused one. A style of our own gets no system focus effect.
struct QuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// A quiet text button that turns amber when focused.
struct LinkButton: View {
    let title: String
    let action: () -> Void
    @FocusState private var focused: Bool
    var body: some View {
        Button(action: action) {
            Text(title).font(Theme.body(30))
                .foregroundStyle(focused ? Theme.black : Theme.text2)
                .padding(.horizontal, 28).padding(.vertical, 14)
                .background(focused ? Theme.amber : Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(QuietButtonStyle())
        .focused($focused)
        .scaleEffect(focused ? 1.06 : 1)
        .animation(.easeOut(duration: 0.15), value: focused)
    }
}
