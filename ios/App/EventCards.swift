import FuorirottaCore
import SwiftUI

/// Evento senza foto: categoria al 16% come fondo, simbolo al centro nel colore della categoria.
struct CategoryPlaceholder: View {
    let category: String?

    var body: some View {
        let visual = categoryVisual(category)
        visual.color.opacity(0.16)
            .overlay {
                Image(systemName: visual.symbol)
                    .font(.largeTitle)
                    .foregroundStyle(visual.color)
            }
            .accessibilityHidden(true)
    }
}

/// "6-8 novembre · Luogo": il luogo manca senza lasciare separatori vuoti.
func eventMeta(_ event: Event) -> String {
    var parts: [String] = []
    if let days = eventDays(dateStart: event.dateStart, dateEnd: event.dateEnd) {
        parts.append(formatDayRange(from: days.from, to: days.to))
    }
    if let place = event.locationName, !place.isEmpty { parts.append(place) }
    return parts.joined(separator: " · ")
}

struct HeroCard: View {
    static let height: CGFloat = 360
    // Misura di decodifica: lato lungo della card su un iPhone (la larghezza reale dipende dallo schermo).
    static let imageSize = CGSize(width: 400, height: height)

    let event: Event

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        let visual = categoryVisual(category)
        RemoteImage(url: event.imageUrl, category: category, size: Self.imageSize)
            .overlay(alignment: .bottom) {
                // Sfumatura fissa sotto il testo: il bianco regge il contrasto su qualunque foto.
                LinearGradient(colors: [Color.scrim.opacity(0), Color.scrim], startPoint: .top, endPoint: .bottom)
                    .frame(height: Self.height * 0.6)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(verbatim: event.title)
                        .font(.heading)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .truncationMode(.tail)
                    Text(verbatim: eventMeta(event))
                        .font(.label)
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(1)
                    if let name = category {
                        Label {
                            Text(verbatim: name)
                        } icon: {
                            Image(systemName: visual.symbol)
                        }
                        .font(.label)
                        .foregroundStyle(.white)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, Spacing.xs)
                        .background(visual.color, in: Capsule())
                    }
                }
                .padding(Spacing.md)
            }
            .frame(height: Self.height)
            .clipShape(RoundedRectangle(cornerRadius: Radius.card))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: [event.title, eventMeta(event), category].compactMap { $0 }.joined(separator: ", ")))
    }
}
