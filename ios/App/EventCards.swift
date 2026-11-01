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

/// Eroe a tutta larghezza (REF Omniphile): la foto arriva fino al bordo alto, sotto la status bar (`topInset`).
struct HeroCard: View {
    static let height: CGFloat = 360
    // Misura di decodifica: lato lungo della card su un iPhone (la larghezza reale dipende dallo schermo).
    static let imageSize = CGSize(width: 440, height: height + 60)
    // Spazio per il segnalibro di vetro a destra del titolo.
    private static let bookmarkSlot: CGFloat = 44 + Spacing.sm

    let event: Event
    var topInset: CGFloat = 0

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
                .padding(.trailing, Self.bookmarkSlot)
            }
            .frame(height: Self.height + topInset)
            .clipped()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: [event.title, eventMeta(event), category].compactMap { $0 }.joined(separator: ", ")))
            // Dopo l'elemento accessibile della card: il segnalibro e' un controllo a parte per VoiceOver.
            // In basso a destra: in alto stanno i pulsanti dell'intestazione di Home.
            .overlay(alignment: .bottomTrailing) {
                BookmarkButton(event: event, style: .glass).padding(Spacing.md)
            }
    }
}

/// Scheda di una fila (Vicino a te, Per te): 176 di larghezza, foto 4:3 (132). L'altezza e' libera: con i testi
/// accessibili i titoli vanno a capo e la scheda cresce, senza tagli.
struct RailCard: View {
    static let width: CGFloat = 176
    static let imageHeight: CGFloat = 132
    static let imageSize = CGSize(width: width, height: imageHeight)

    let event: Event
    @Environment(\.dynamicTypeSize) private var typeSize

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            RemoteImage(url: event.imageUrl, category: category, size: Self.imageSize)
                .frame(width: Self.width, height: Self.imageHeight)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .overlay(alignment: .topTrailing) {
                    // Vetro e non "plain": sta sopra una foto qualunque e deve restare leggibile.
                    BookmarkButton(event: event, style: .glass).padding(Spacing.xs)
                }
            Text(verbatim: event.title)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.foreground)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                .truncationMode(.tail)
            Text(verbatim: eventMeta(event))
                .font(.label)
                .foregroundStyle(Color.mutedForeground)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
        }
        .frame(width: Self.width, alignment: .topLeading)
        .accessibilityElement(children: .contain)
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

/// Riga dell'elenco "Vedi tutto": miniatura 72, titolo (2 righe, tutte con i testi accessibili), data e luogo, segnalibro.
struct EventRow: View {
    let event: Event
    @Environment(\.dynamicTypeSize) private var typeSize

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            RemoteImage(url: event.imageUrl, category: category, size: CGSize(width: 72, height: 72))
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: event.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.foreground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                Text(verbatim: eventMeta(event))
                    .font(.label)
                    .foregroundStyle(Color.mutedForeground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                if let name = category {
                    HStack(spacing: Spacing.xs) {
                        Circle().fill(categoryVisual(name).color).frame(width: 8, height: 8)
                        Text(verbatim: name).font(.label).foregroundStyle(Color.mutedForeground)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            Spacer(minLength: 0)
            BookmarkButton(event: event, style: .plain)
        }
    }
}

/// Elenco di una fila ("Vedi tutto"): fino a 100 eventi della stessa fonte. Carica, mostra lo scheletro, l'errore con Riprova o il vuoto.
struct EventListView: View {
    let title: String
    let loader: () async throws -> [Event]

    private enum Phase { case loading, loaded([Event]), failed }
    @State private var phase = Phase.loading

    var body: some View {
        List {
            switch phase {
            case .loading:
                ForEach(0..<6, id: \.self) { _ in
                    HStack(spacing: Spacing.md) {
                        RoundedRectangle(cornerRadius: Radius.md).fill(Color.surface).frame(width: 72, height: 72)
                        VStack(alignment: .leading) {
                            Text("Titolo dell'evento in due righe").font(.body.weight(.semibold))
                            Text("6-8 novembre · Luogo").font(.label)
                        }
                    }
                    .redacted(reason: .placeholder)
                    .listRowSeparator(.hidden)
                    .accessibilityHidden(true)
                }
            case .loaded(let events):
                if events.isEmpty {
                    ContentUnavailableView {
                        Label("Nessun evento", systemImage: "calendar")
                    } description: {
                        Text("Non c'è ancora niente qui. Riprova più tardi.")
                    }
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(events) { EventRow(event: $0).listRowSeparator(.hidden) }
                }
            case .failed:
                ContentUnavailableView {
                    Label("Eventi non disponibili", systemImage: "wifi.slash")
                } description: {
                    Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
                } actions: {
                    Button("Riprova") { Task { await load() } }
                }
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .navigationTitle(Text(verbatim: title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            phase = .loaded(try await loader())
        } catch {
            // Un aggiornamento che fallisce lascia l'elenco com'e'.
            guard !Task.isCancelled else { return }
            if case .loaded = phase { return }
            phase = .failed
        }
    }
}
