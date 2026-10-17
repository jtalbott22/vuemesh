import SwiftUI

/// A code typed with the Siri Remote: one tall cell per character, like a character generator's
/// slots, over a keypad of only the characters codes use. It submits on the last character.
struct CodeEntry: View {
    let length: Int
    var cellSize: CGFloat = 132
    var bad = false
    let onComplete: (String) -> Void

    @State private var chars: [Character] = []
    private let rows: [[Character]] = [Array(Codes.chars.prefix(16)), Array(Codes.chars.dropFirst(16))]

    var body: some View {
        VStack(spacing: 44) {
            HStack(spacing: cellSize * 0.14) {
                ForEach(0..<length, id: \.self) { i in
                    let ch = i < chars.count ? String(chars[i]) : ""
                    Text(ch)
                        .font(Theme.display(cellSize))
                        .foregroundStyle(Theme.text)
                        .frame(width: cellSize * 0.9, height: cellSize * 1.15)
                        .background(Theme.cell)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(bad ? Theme.tally : i == chars.count ? Theme.amber : Theme.line)
                                .frame(height: max(6, cellSize * 0.06))
                        }
                        .accessibilityLabel(ch.isEmpty ? "Empty" : ch)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Code, \(chars.count) of \(length) characters")

            VStack(spacing: 14) {
                ForEach(rows.indices, id: \.self) { r in
                    HStack(spacing: 14) {
                        ForEach(rows[r], id: \.self) { ch in
                            Key(label: String(ch)) { type(ch) }
                        }
                        if r == rows.count - 1 {
                            Key(label: "⌫", wide: true) { if !chars.isEmpty { chars.removeLast() } }
                                .accessibilityLabel("Delete")
                        }
                    }
                }
            }
        }
        .onChange(of: bad) { _, isBad in if isBad { chars.removeAll() } }
    }

    private func type(_ ch: Character) {
        guard chars.count < length else { return }
        chars.append(ch)
        if chars.count == length {
            onComplete(String(chars))
        }
    }
}

private struct Key: View {
    let label: String
    var wide = false
    let action: () -> Void
    @FocusState private var focused: Bool
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(Theme.display(48))
                .foregroundStyle(focused ? Theme.black : Theme.text)
                .frame(width: wide ? 150 : 88, height: 88)
                .background(focused ? Theme.amber : Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .focused($focused)
        .scaleEffect(focused ? 1.12 : 1)
        .animation(.easeOut(duration: 0.12), value: focused)
    }
}
