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

    func loadMoreIfNeeded(current: Event, api: APIClient?) async {
        guard let api, !loading, !failed, hasMore, events.suffix(Self.prefetch).contains(where: { $0.id == current.id }) else { return }
        await loadPage(api: api)
    }

    private func loadPage(api: APIClient, replacing: Bool = false) async {
        let mine = epoch
        loading = true
        failed = false
        let offset = replacing ? 0 : events.count
        do {
            let page = try await api.allEvents(category: nil, limit: Self.pageSize, offset: offset)
            guard mine == epoch else { return }
            commit(replacing ? page.events : appendingNew(page.events, to: events), total: page.total)
        } catch {
            guard mine == epoch else { return }
            failed = !Task.isCancelled
        }
        loading = false
    }

    private func commit(_ list: [Event], total: Int) {
        events = list
        self.total = total
        // ponytail: si ricalcola tutta la timeline a ogni pagina (O(n)); spezzare per pagina se i 9.000 eventi pesano.
        timeline = allEventsTimeline(list, today: romeToday(), locale: .app)
    }
}

struct AllEventsSection: View {
    let model: AllEventsModel
    @Environment(\.api) private var api

    var body: some View {
        let today = romeToday()
        Section {
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
            if model.loading {
                ProgressView().frame(maxWidth: .infinity).padding(Spacing.md)
            }
            Color.clear.frame(height: 0).task { await model.start(api: api) }
        } header: {
            Text("Tutti gli eventi")
                .font(.heading)
                .foregroundStyle(Color.foreground)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.background)
        }
    }
}
