import FuorirottaCore
import Observation
import SwiftUI

/// Una riga di Salvati. Ospite: entryID = id salvato sul telefono. Account: entryID = id della riga sul server.
struct SavedRow: Identifiable, Equatable, Codable {
    let id: String
    let entryID: Int
    /// Id dell'evento vivo; nil se l'evento non esiste piu'.
    let eventID: Int?
    let title: String
    let place: String?
    let dateStart: String
    let dateEnd: String?
    let category: String
    let gone: Bool

    /// Vive dal resolver (live) con ripiego sull'istantanea salvata; senza nessuna delle due resta il segnaposto.
    init(entryID: Int, eventID: Int?, snap: Snap?, gone: Bool, prefix: String) {
        id = "\(prefix)\(entryID)"
        self.entryID = entryID
        self.eventID = gone ? nil : eventID
        title = snap?.title ?? "Evento salvato"
        place = snap?.place
        dateStart = snap?.dateStart ?? ""
        dateEnd = snap?.dateEnd
        category = snap?.category ?? "Altro"
        self.gone = gone
    }

    var days: (startDay: String, endDay: String)? { eventDays(dateStart: dateStart, dateEnd: dateEnd) }

    var meta: String {
        var parts: [String] = []
        if let d = days { parts.append(formatDayRange(from: d.startDay, to: d.endDay)) }
        if let place, !place.isEmpty { parts.append(place) }
        return parts.joined(separator: " · ")
    }
}

@MainActor @Observable
final class SavesModel {
    /// Id salvati (sul telefono per l'ospite): accende i segnalibri.
    private(set) var ids: Set<Int> = []
    private(set) var rows: [SavedRow] = []
    private(set) var loading = true
    /// Contatori per .sensoryFeedback: cambiano a ogni esito.
    private(set) var warningCount = 0

    private let api: APIClient
    private let store: GuestStore

    init(api: APIClient, store: GuestStore = GuestStore()) {
        self.api = api
        self.store = store
    }

    /// All'avvio, prima di Session.restore: i segnalibri partono accesi senza aspettare la rete.
    func start() async {
        ids = Set(await store.all().map(\.id))
    }

    func isSaved(_ id: Int) -> Bool { ids.contains(id) }

    /// Ottimistico: il segnalibro si accende subito, il file sul telefono segue.
    func toggle(_ event: Event) async {
        let wasSaved = ids.contains(event.id)
        if wasSaved { ids.remove(event.id) } else { ids.insert(event.id) }
        if await store.toggle(id: event.id, snap: Snap(event: event), now: .now) == .cap {
            ids.remove(event.id)
            warningCount += 1
        }
    }

    /// Risolve gli id del telefono dal server (POST, in blocchi da 100). Senza rete restano le istantanee salvate.
    func reload() async {
        let entries = await store.all()
        ids = Set(entries.map(\.id))
        if entries.isEmpty {
            rows = []
            loading = false
            return
        }
        do {
            var resolved: [Int: SavedItem] = [:]
            for chunk in stride(from: 0, to: entries.count, by: 100) {
                let part = entries[chunk..<min(chunk + 100, entries.count)].map(\.id)
                for item in try await api.resolve(ids: part) { resolved[item.ref] = item }
            }
            rows = entries.map { e in
                let item = resolved[e.id]
                let live = item?.live
                return SavedRow(entryID: e.id, eventID: item?.eventId, snap: live ?? e.snap, gone: live == nil, prefix: "g")
            }
            // Un'istantanea nuova dal server sostituisce quella tenuta sul telefono.
            for e in entries { if let live = resolved[e.id]?.live, live != e.snap { await store.setSnap(e.id, live) } }
        } catch {
            rows = entries.map { SavedRow(entryID: $0.id, eventID: $0.id, snap: $0.snap, gone: false, prefix: "g") }
        }
        loading = false
    }
}
