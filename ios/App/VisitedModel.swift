import FuorirottaCore
import Observation
import SwiftUI

private enum Copy {
    static var guestCap: String { String(localized: "Hai raggiunto il limite di 100 eventi visitati senza account. Accedi per segnarne fino a 500.") }
}

/// "Ci sono stato" (D-01). Separato dai salvati (D-04): non conosce SavesModel, il toast passa dalla chiusura `show`.
/// Nessun framework di posizione (T-27-33): un segno nasce solo da un tocco sul pulsante.
@MainActor @Observable
final class VisitedModel {
    /// Id degli eventi segnati: accendono la pillola del dettaglio.
    private(set) var ids: Set<Int> = []
    /// Contatori per .sensoryFeedback: cambiano a ogni esito, anche uguale al precedente.
    private(set) var successCount = 0
    private(set) var warningCount = 0
    private(set) var errorCount = 0

    private let api: APIClient
    private let store: GuestStore
    private let show: @MainActor (String) -> Void

    init(api: APIClient, store: GuestStore = GuestStore(fileURL: GuestStore.visitedFileURL), show: @escaping @MainActor (String) -> Void) {
        self.api = api
        self.store = store
        self.show = show
    }

    /// All'avvio: i segni del telefono partono accesi senza aspettare la rete.
    func start() async {
        ids = Set(await store.all().map(\.id))
        await refreshGuestStats()
    }

    private func refreshGuestStats() async {
        guestStats = await store.all().compactMap { e in
            e.visitDay.map { VisitedStatItem(visitDay: $0, category: e.snap?.category) }
        }
    }

    func isVisited(_ event: Event) -> Bool { ids.contains(event.id) }

    /// D-02: il giorno di visita di oggi (Roma) per questo evento, o nil se non e' ancora iniziato (niente pillola).
    func visitDay(for event: Event) -> String? {
        visitDayFor(dateStart: event.dateStart, dateEnd: event.dateEnd, today: romeToday())
    }

    /// Ottimistico: la pillola cambia subito e torna indietro se il segno non riesce.
    func toggle(_ event: Event) async {
        guard let day = visitDay(for: event) else { return }
        let was = ids.contains(event.id)
        if was { ids.remove(event.id) } else { ids.insert(event.id) }
        // D-05: il giorno si decide qui, al tocco, e resta quello.
        if await store.toggle(id: event.id, snap: Snap(event: event), now: .now, visitDay: day) == .cap {
            ids.remove(event.id)
            warningCount += 1
            show(Copy.guestCap)
        } else if !was {
            successCount += 1
        }
        await refreshGuestStats()
    }

    /// Giorno di visita e categoria dei segni, per le statistiche (27.1-10).
    var statItems: [VisitedStatItem] { guestStats }
    private var guestStats: [VisitedStatItem] = []
}
