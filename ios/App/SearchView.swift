import FuorirottaCore
import SwiftUI

/// Scheda Cerca: `.searchable` dentro la scheda con ruolo search fa disegnare a iOS 26 la pillola di vetro in basso
/// che si espande a ricerca a tutto schermo (27-SPIKE.md: "Search pill: system"). Digitando si cerca su tutto il
/// catalogo, senza posizione. Con il campo vuoto: le ricerche recenti come chip. La data e' quella dell'app (`DateFilter`,
/// D-08): parte da Questo weekend (D-09) ed e' la stessa di Eventi e Mappa; qui restano testo, zona e categorie.
struct SearchView: View {
    private enum Phase {
        case idle, loading, failed
        case results([Event], for: String)
    }

    private static let recentsKey = "fr.recentQueries"

    @Environment(\.api) private var api
    @Environment(LocationModel.self) private var location
    @Environment(DateFilter.self) private var dateFilter

    // La sua `when` non si legge: vale quella di `dateFilter` (vedi `effective`).
    @State private var filters = SearchFilters()
    @State private var showFilters = false
    @State private var phase = Phase.idle
    @State private var recents = UserDefaults.standard.stringArray(forKey: SearchView.recentsKey) ?? []
    @State private var path = NavigationPath()

    private var term: String { filters.term }
    /// I filtri con la data dell'app: e' quello che si mostra, si chiede e si passa al foglio.
    private var effective: SearchFilters {
        var f = filters
        f.when = dateFilter.when
        return f
    }

    var body: some View {
        EventStack(path: $path) {
            content
                .navigationTitle("Cerca")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        // Vetro di sistema; in accento con almeno un filtro attivo.
                        Button { showFilters = true } label: {
                            Image(systemName: "line.3.horizontal.decrease")
                                .foregroundStyle(effective.hasActiveFilters ? Color.accentToken : Color.primary)
                        }
                        .accessibilityLabel("Filtri")
                        .accessibilityValue(effective.hasActiveFilters ? "attivi" : "")
                    }
                }
        }
        .searchable(text: $filters.text, prompt: "Cerca eventi")
        .onSubmit(of: .search) { record(filters.text) }
        // Aprire un risultato conferma la ricerca: torna indietro e la chip c'e'.
        .onChange(of: path.count) { old, new in if new > old { record(filters.text) } }
        // Con "Vicino a" acceso la zona segue quella dell'app (anche se cambia dal foglio della zona).
        .onChange(of: location.place) { _, place in
            if filters.near != nil { filters.near?.lat = place.latitude; filters.near?.lng = place.longitude }
        }
        .sheet(isPresented: $showFilters) {
            // Due vie: la data scelta qui e' quella di tutta l'app (D-08), il resto resta di Cerca.
            SearchFiltersSheet(filters: Binding(
                get: { effective },
                set: { new in
                    filters = new
                    dateFilter.when = new.when
                }))
        }
        .task(id: effective) { await run() }
    }

    private var content: some View {
        // UAT 6: con una lista di risultati i filtri attivi sono la prima riga e scorrono via con lei (niente fascia fissa);
        // negli altri stati (caricamento, vuoto, errore) non c'e' nulla che scorra e stanno in cima.
        VStack(spacing: 0) {
            if effective.hasFilters, !showsList { activeFilters }
            results
        }
    }

    private var showsList: Bool {
        if !effective.isIdle, case .results(let events, _) = phase { return !events.isEmpty }
        return false
    }

    @ViewBuilder private var results: some View {
        if effective.isIdle {
            idle
        } else {
            switch phase {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed:
                ContentUnavailableView {
                    Label("Eventi non disponibili", systemImage: "wifi.slash")
                } description: {
                    Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
                } actions: {
                    Button("Riprova") { Task { await run() } }
                }
            case .results(let events, let asked):
                if events.isEmpty {
                    ContentUnavailableView {
                        Label {
                            Text(verbatim: asked.isEmpty ? String(localized: "Nessun risultato") : String(localized: "Nessun risultato per \"\(asked)\""))
                        } icon: {
                            Image(systemName: "magnifyingglass")
                        }
                    } description: {
                        Text(effective.hasFilters
                            ? "Prova a togliere o allargare qualche filtro."
                            : "Controlla la parola o prova con un luogo o una categoria.")
                    }
                } else {
                    List {
                        if effective.hasFilters {
                            activeFilters
                                .listRowInsets(EdgeInsets())
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                        }
                        ForEach(events) { EventRow(event: $0).listRowSeparator(.hidden) }
                    }
                    .listStyle(.plain)
                }
            }
        }
    }

    // MARK: filtri attivi: chip rimovibili sopra i risultati

    private var activeFilters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.sm) {
                if effective.when != .any {
                    removable(effective.when.title(locale: .app)) { dateFilter.when = .any }
                }
                if let near = filters.near {
                    removable(String(localized: "Entro \(near.radiusKm) km da \(location.place.name)")) { filters.near = nil }
                }
                ForEach(filters.categories, id: \.self) { name in
                    removable(categoryLabel(name)) { filters.categories.removeAll { $0 == name } }
                }
            }
            .padding(.horizontal, Spacing.md)
        }
        .scrollIndicators(.hidden)
        .padding(.vertical, Spacing.sm)
    }

    private func removable(_ title: String, remove: @escaping () -> Void) -> some View {
        Button {
            withAnimation(Motion.snappy) { remove() }
        } label: {
            HStack(spacing: Spacing.xs) {
                Text(verbatim: title).font(.label).foregroundStyle(Color.foreground)
                Image(systemName: "xmark").font(.caption2.weight(.bold)).foregroundStyle(Color.mutedForeground)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: 44)
            .background(Color.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("\(title), tocca per togliere"))
    }

    // MARK: campo vuoto: chip recenti

    @ViewBuilder private var idle: some View {
        if recents.isEmpty {
            ContentUnavailableView(
                "Cerca eventi", systemImage: "magnifyingglass",
                description: Text("Scrivi un titolo, un luogo o una categoria."))
        } else {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text("Recenti").font(.heading).foregroundStyle(Color.foreground).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button("Cancella") {
                        recents = []
                        UserDefaults.standard.removeObject(forKey: Self.recentsKey)
                    }
                    .font(.label.weight(.semibold))
                    .foregroundStyle(Color.accentToken)
                }
                .padding(.horizontal, Spacing.md)
                ScrollView(.horizontal) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(recents, id: \.self) { recent in
                            Button {
                                filters.text = recent
                            } label: {
                                Label {
                                    Text(verbatim: recent)
                                } icon: {
                                    Image(systemName: "clock")
                                }
                                .font(.label)
                                .foregroundStyle(Color.foreground)
                                .padding(.horizontal, Spacing.md)
                                .padding(.vertical, Spacing.sm)
                                .frame(minHeight: 44)
                                .background(Color.surface, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                }
                .scrollIndicators(.hidden)
                Spacer(minLength: 0)
            }
            .padding(.top, Spacing.sm)
        }
    }

    // MARK: ricerca

    private func record(_ q: String) {
        recents = RecentQueries.adding(q, to: recents)
        UserDefaults.standard.set(recents, forKey: Self.recentsKey)
    }

    /// 300 ms dopo l'ultimo tasto (la nuova digitazione annulla questa attesa), poi la richiesta.
    private func run() async {
        let asked = term
        let current = effective
        guard !current.isIdle else {
            phase = .idle
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled, let api else { return }
        // Un aggiornamento non svuota l'elenco: il giro di attesa c'e' solo la prima volta.
        if case .results = phase {} else { phase = .loading }
        do {
            phase = .results(try await api.search(current, limit: 30), for: asked)
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failed
        }
    }
}
