import SwiftUI

/// Pre-rendered snapshot text with its FIRST occurrence of `emphasis` restyled
/// ("tonight: **tacos**, Sam cooks"). Absent or not found = plain. The substring form keeps
/// word order the translator's, so this view never re-assembles a sentence.
struct WidgetTextView: View {
    let text: WSText
    let font: Font
    let color: Color
    let emphasisFont: Font
    let emphasisColor: Color

    var body: some View {
        Text(attributed)
    }

    private var attributed: AttributedString {
        var result = AttributedString(text.text)
        let baseFont: Font = font
        let baseColor: Color = color
        result.font = baseFont
        result.foregroundColor = baseColor
        if let emphasis = text.emphasis, !emphasis.isEmpty, let range = result.range(of: emphasis) {
            let strongFont: Font = emphasisFont
            let strongColor: Color = emphasisColor
            result[range].font = strongFont
            result[range].foregroundColor = strongColor
        }
        return result
    }
}
