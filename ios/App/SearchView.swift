import FuorirottaCore
import SwiftUI

/// Scheda Cerca: `.searchable` dentro la scheda con ruolo search fa disegnare a iOS 26 la pillola di vetro in basso
/// che si espande a ricerca a tutto schermo (27-SPIKE.md: "Search pill: system"). Digitando si cerca su tutto il
/// catalogo, senza posizione. Con il campo vuoto: le ricerche recenti come chip.
struct SearchView: View {
    private enum Phase {
        case idle, loading, failed
        case results([Event], for: String)
    }

    private static let recentsKey = "fr.recentQueries"

    @Environment(\.api) private var api

    @State private var query = ""
    @State private var phase = Phase.idle
    @State private var recents = UserDefaults.standard.stringArray(forKey: SearchView.recentsKey) ?? []
    @State private var path = NavigationPath()

    private var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        EventStack(path: $path) {
            content
                .navigationTitle("Cerca")
        }
        .searchable(text: $query, prompt: "Cerca eventi")
        .onSubmit(of: .search) { record(query) }
        // Aprire un risultato conferma la ricerca: torna indietro e la chip c'e'.
        .onChange(of: path.count) { old, new in if new > old { record(query) } }
        .task(id: query) { await run() }
    }

    @ViewBuilder private var content: some View {
        if term.isEmpty {
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
                            Text(verbatim: "Nessun risultato per \"\(asked)\"")
                        } icon: {
                            Image(systemName: "magnifyingglass")
                        }
                    } description: {
                        Text("Controlla la parola o prova con un luogo o una categoria.")
                    }
                } else {
                    List(events) { EventRow(event: $0).listRowSeparator(.hidden) }
                        .listStyle(.plain)
                }
            }
        }
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
                                query = recent
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
        guard !asked.isEmpty else {
            phase = .idle
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled, let api else { return }
        // Un aggiornamento non svuota l'elenco: il giro di attesa c'e' solo la prima volta.
        if case .results = phase {} else { phase = .loading }
        do {
            phase = .results(try await api.search(q: asked, limit: 30), for: asked)
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failed
        }
    }
}
