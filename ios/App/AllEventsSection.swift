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
    /// Vuoto = Tutte.
    private(set) var categories: Set<String> = []
    /// Cambia a ogni ripartenza: una risposta di una generazione vecchia si butta (cambio categoria, pull-to-refresh).
    private var epoch = 0

    var hasMore: Bool { events.count < total }

    /// Prima pagina, una volta sola: la vista pigra la richiama a ogni comparsa, qui non riparte nulla se c'e' gia' qualcosa.
    /// La richiesta non e' legata alla vista: Home toglie e rimette la sezione quando si ricarica (posizione, accesso),
    /// e una richiesta annullata a meta' lasciava la lista ferma sul caricamento (giro telefono F5).
    func start(api: APIClient?) async {
        guard let api, events.isEmpty, !loading, !failed else { return }
        loading = true
        Task { await loadPage(api: api) }
    }

    /// Ricomincia da capo (pull-to-refresh): non svuota lo schermo finche' la prima pagina non e' arrivata.
    func restart(api: APIClient?) async {
        guard let api else { return }
        epoch += 1
        await loadPage(api: api, replacing: true)
    }

    /// Un'altra scelta di categorie: la lista riparte vuota e le risposte della precedente si buttano.
    /// Sincrona: il menu resta aperto e il tocco dopo legge subito l'insieme aggiornato.
    func select(_ categories: Set<String>, api: APIClient?) {
        guard categories != self.categories else { return }
        self.categories = categories
        epoch += 1
        events = []
        timeline = []
        total = 0
        offline = false
        failed = false
        didLoad = false
        guard let api else { return }
        Task { await loadPage(api: api) }
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
            let page = try await api.allEvents(categories: categories.sorted(), limit: Self.pageSize, offset: offset)
            guard mine == epoch else { return }
            commit(replacing ? page.events : appendingNew(page.events, to: events), total: page.total)
            offline = false
            if offset == 0, categories.isEmpty { Self.write(Cached(events: page.events, total: page.total)) }
        } catch {
            guard mine == epoch else { return }
            if Task.isCancelled {
                // Annullata (la riga che la lancia e' uscita dallo schermo): non e' un guasto e nemmeno "vuoto".
                // Niente didLoad, cosi' non compare "Nessun evento" e la prossima comparsa riparte (giro telefono F5).
                loading = false
                return
            } else if replacing, !events.isEmpty {
                // Un aggiornamento che fallisce lascia la lista com'e'.
            } else if offset == 0, categories.isEmpty, let cached = Self.read() {
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

/// Il filtro per categoria di mappa e "Tutti gli eventi": un pulsante che apre un menu a scelta multipla.
/// Insieme vuoto = Tutte. L'unica vibrazione di selezione del filtro, per entrambe le schermate.
struct CategoryFilter: View {
    @Binding var selection: Set<String>

    private var active: Bool { !selection.isEmpty }

    var body: some View {
        Menu {
            Toggle("Tutte", isOn: Binding(get: { selection.isEmpty }, set: { if $0 { selection = [] } }))
            Divider()
            ForEach(ApiContract.categories, id: \.self) { name in
                Toggle(isOn: Binding(
                    get: { selection.contains(name) },
                    set: { if $0 { selection.insert(name) } else { selection.remove(name) } })
                ) { Text(verbatim: categoryLabel(name)) }
            }
        } label: {
            Image(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .font(.title3)
                .foregroundStyle(active ? Color.accentToken : Color.primary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .menuActionDismissBehavior(.disabled)
        .sensoryFeedback(.selection, trigger: selection)
        .accessibilityLabel(Text("Categorie"))
        .accessibilityValue(active
            ? Text(verbatim: ApiContract.categories.filter(selection.contains).map(categoryLabel).joined(separator: ", "))
            : Text("Tutte"))
    }
}

struct AllEventsSection: View {
    let model: AllEventsModel
    /// Home ignora la safe area in alto: l'intestazione fissata deve stare sotto la status bar (A4, da provare sul telefono).
    let topInset: CGFloat
    @Environment(\.api) private var api

    var body: some View {
        let today = romeToday()
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
            if model.events.isEmpty {
                // Lista vuota (filtro appena cambiato): uno schermo d'altezza, cosi' il salto all'inizio della sezione non viene tagliato.
                footer.containerRelativeFrame(.vertical, alignment: .top)
            } else {
                footer
            }
            Color.clear.frame(height: 0).task { await model.start(api: api) }
        } header: {
            HStack {
                Text("Tutti gli eventi")
                    .font(.heading)
                    .foregroundStyle(Color.foreground)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                CategoryFilter(selection: Binding(get: { model.categories }, set: { model.select($0, api: api) }))
            }
            .padding(.horizontal, Spacing.md)
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
