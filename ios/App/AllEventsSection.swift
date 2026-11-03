import FuorirottaCore
import SwiftUI

/// "Tutti gli eventi" di Home (D-13, D-15): tutta l'Italia da oggi in poi, nell'ordine del sito, 30 alla volta.
/// Nessuna posizione parte con queste richieste (T-27-25): la lista e' la stessa per tutti.
@MainActor @Observable
final class AllEventsModel {
    static let pageSize = 30
    /// Quanti eventi prima della fine devono comparire perche' parta la pagina dopo.
    private static let prefetch = 8

    private(set) var events: [Event] = []
    private(set) var timeline: [SavedDay<Event>] = []
    private(set) var total = 0
    private(set) var loading = false
    private(set) var failed = false
    /// Rete assente: si vede la prima pagina salvata su disco.
    private(set) var offline = false
    /// Almeno una risposta (o un errore) per questa generazione: distingue "vuoto" da "non ancora caricato".
    private(set) var didLoad = false
    /// nil = Tutte.
    private(set) var category: String?
    /// Cambia a ogni ripartenza: una risposta di una generazione vecchia si butta (cambio categoria, pull-to-refresh).
    private var epoch = 0

    var hasMore: Bool { events.count < total }

    /// Prima pagina, una volta sola: la vista pigra la richiama a ogni comparsa, qui non riparte nulla se c'e' gia' qualcosa.
    func start(api: APIClient?) async {
        guard let api, events.isEmpty, !loading, !failed else { return }
        await loadPage(api: api)
    }

    /// Ricomincia da capo (pull-to-refresh): non svuota lo schermo finche' la prima pagina non e' arrivata.
    func restart(api: APIClient?) async {
        guard let api else { return }
        epoch += 1
        await loadPage(api: api, replacing: true)
    }

    /// Un altro chip: la lista riparte vuota per quella categoria e le risposte della precedente si buttano.
    func select(_ category: String?, api: APIClient?) async {
        guard category != self.category else { return }
        self.category = category
        epoch += 1
        events = []
        timeline = []
        total = 0
        offline = false
        failed = false
        didLoad = false
        guard let api else { return }
        await loadPage(api: api)
    }

    /// "Carica altri" / "Riprova": la pagina che manca, a mano.
    func loadMore(api: APIClient?) async {
        guard let api, !loading else { return }
        await loadPage(api: api)
    }

    func loadMoreIfNeeded(current: Event, api: APIClient?) async {
        guard let api, !loading, !failed, !offline, hasMore, events.suffix(Self.prefetch).contains(where: { $0.id == current.id }) else { return }
        await loadPage(api: api)
    }

    private func loadPage(api: APIClient, replacing: Bool = false) async {
        let mine = epoch
        loading = true
        failed = false
        let offset = replacing ? 0 : events.count
        do {
            let page = try await api.allEvents(category: category, limit: Self.pageSize, offset: offset)
            guard mine == epoch else { return }
            commit(replacing ? page.events : appendingNew(page.events, to: events), total: page.total)
            offline = false
            if offset == 0, category == nil { Self.write(Cached(events: page.events, total: page.total)) }
        } catch {
            guard mine == epoch else { return }
            if Task.isCancelled {
                // Niente da dire: l'attivita' e' stata annullata, non e' un guasto.
            } else if replacing, !events.isEmpty {
                // Un aggiornamento che fallisce lascia la lista com'e'.
            } else if offset == 0, category == nil, let cached = Self.read() {
                commit(cached.events, total: cached.total)
                offline = true
            } else {
                failed = true
            }
        }
        didLoad = true
        loading = false
    }

    // Solo la prima pagina senza filtro, pubblica: niente dell'account va su disco (stesso schema di HomeModel).
    private struct Cached: Codable {
        let events: [Event]
        let total: Int
    }

    private static var cacheURL: URL { URL.cachesDirectory.appending(path: "fuorirotta/all-events.json") }

    private static func write(_ cached: Cached) {
        // ponytail: scrittura fallita = niente cache offline, nient'altro.
        try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(cached) { try? data.write(to: cacheURL, options: .atomic) }
    }

    private static func read() -> Cached? {
        guard let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? JSONDecoder().decode(Cached.self, from: data)
    }

    private func commit(_ list: [Event], total: Int) {
        events = list
        self.total = total
        // ponytail: si ricalcola tutta la timeline a ogni pagina (O(n)); spezzare per pagina se i 9.000 eventi pesano.
        timeline = allEventsTimeline(list, today: romeToday(), locale: .app)
    }
}

/// La riga di chip della mappa e di "Tutti gli eventi": "Tutte" (nil) e le sette categorie.
struct CategoryChips: View {
    @Binding var selection: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.sm) {
                chip(String(localized: "Tutte"), value: nil)
                ForEach(ApiContract.categories, id: \.self) { chip(categoryLabel($0), value: $0) }
            }
            .padding(.horizontal, Spacing.md)
        }
        .scrollIndicators(.hidden)
    }

    private func chip(_ title: String, value: String?) -> some View {
        let selected = selection == value
        return Button { selection = value } label: {
            Text(verbatim: title)
                .font(.label.weight(.semibold))
                .foregroundStyle(selected ? Color.white : Color.foreground)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .glassEffect(selected ? .regular.tint(Color.accentToken).interactive() : .regular.interactive(), in: .capsule)
        .accessibilityLabel(selected ? Text("\(title), selezionato") : Text(verbatim: title))
    }
}

struct AllEventsSection: View {
    let model: AllEventsModel
    /// Home ignora la safe area in alto: le chip fissate devono stare sotto la status bar (A4, da provare sul telefono).
    let topInset: CGFloat
    @Environment(\.api) private var api

    var body: some View {
        let today = romeToday()
        Text("Tutti gli eventi")
            .font(.heading)
            .foregroundStyle(Color.foreground)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, Spacing.md)
            .padding(.bottom, Spacing.sm)
        Section {
            if model.offline {
                Label("Sei offline. Mostriamo gli ultimi dati salvati.", systemImage: "wifi.slash")
                    .font(.label)
                    .foregroundStyle(Color.foregroundSecondary)
                    .card()
                    .padding(.horizontal, Spacing.md)
                    .padding(.top, Spacing.sm)
            }
            ForEach(model.timeline) { day in
                if let month = day.month {
                    Text(verbatim: month)
                        .font(.heading)
                        .foregroundStyle(Color.foreground)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.horizontal, Spacing.md)
                        .padding(.top, Spacing.lg)
                }
                if let d = day.day {
                    Text(verbatim: d == today ? String(localized: "Oggi") : formatTimelineDay(d, locale: .app))
                        .font(.headline)
                        .foregroundStyle(Color.foreground)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.horizontal, Spacing.md)
                        .padding(.top, Spacing.md)
                }
                ForEach(day.items) { event in
                    EventRow(event: event)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.sm)
                        .onAppear { Task { await model.loadMoreIfNeeded(current: event, api: api) } }
                    Divider().padding(.leading, Spacing.md)
                }
            }
            footer
            Color.clear.frame(height: 0).task { await model.start(api: api) }
        } header: {
            CategoryChips(selection: Binding(
                get: { model.category },
                set: { new in Task { await model.select(new, api: api) } }))
                .padding(.top, topInset)
                .padding(.bottom, Spacing.xs)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.background)
        }
    }

    private var retryButton: some View {
        Button { Task { await model.loadMore(api: api) } } label: { model.failed ? Text("Riprova") : Text("Carica altri") }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .frame(maxWidth: .infinity)
            .padding(Spacing.md)
    }

    @ViewBuilder private var footer: some View {
        if model.loading {
            ProgressView().frame(maxWidth: .infinity).padding(Spacing.md)
        } else if model.events.isEmpty {
            if model.failed {
                VStack(spacing: Spacing.sm) {
                    Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
                        .font(.label)
                        .foregroundStyle(Color.mutedForeground)
                        .multilineTextAlignment(.center)
                    retryButton
                }
                .padding(.horizontal, Spacing.md)
            } else if model.didLoad {
                Text("Nessun evento in questa categoria")
                    .font(.label)
                    .foregroundStyle(Color.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.md)
            }
        } else if model.hasMore {
            if model.failed || model.offline { retryButton }
        } else {
            Text("Hai visto tutto")
                .font(.label)
                .foregroundStyle(Color.mutedForeground)
                .frame(maxWidth: .infinity)
                .padding(Spacing.md)
        }
    }
}
