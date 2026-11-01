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
        parts.append(formatDayRange(from: days.startDay, to: days.endDay))
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
            // Dopo l'elemento accessibile della card: il segnalibro e' un controllo a parte per VoiceOver.
            .overlay(alignment: .topTrailing) {
                BookmarkButton(event: event, style: .glass).padding(Spacing.md)
            }
    }
}

/// Segnalibro: vuoto/pieno con rimbalzo (fermo con "Riduci movimento") e tocco leggero. L'accento solo sul simbolo pieno.
struct BookmarkButton: View {
    enum Style { case glass, plain }

    let event: Event
    let style: Style

    @Environment(SavesModel.self) private var saves
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let saved = saves.isSaved(event.id)
        let button = Button {
            Task { await saves.toggle(event) }
        } label: {
            Image(systemName: saved ? "bookmark.fill" : "bookmark")
                .font(.title3)
                .foregroundStyle(saved ? Color.accentToken : Color.primary)
                .symbolEffect(.bounce, value: reduceMotion ? false : saved)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .sensoryFeedback(.impact(flexibility: .soft), trigger: saved)
        .accessibilityLabel(saved ? "Rimuovi dai salvati" : "Salva evento")
        switch style {
        case .glass: button.glassEffect(.regular.interactive(), in: .circle)
        case .plain: button.buttonStyle(.plain)
        }
    }
}
