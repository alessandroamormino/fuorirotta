import FuorirottaCore
import Observation
import SwiftUI

private enum Copy {
    static var failed: String { String(localized: "Non è andata a buon fine. Riprova tra un momento.") }
    static var guestCap: String { String(localized: "Hai raggiunto il limite di 100 eventi visitati senza account. Accedi per segnarne fino a 500.") }
    static var accountCap: String { String(localized: "Hai raggiunto il limite di 500 eventi visitati. Rimuovine qualcuno per aggiungerne altri.") }
}

/// "Ci sono stato" (D-01). Separato dai salvati (D-04): non conosce SavesModel, il toast passa dalla chiusura `show`.
/// Nessun framework di posizione (T-27-33): un segno nasce solo da un tocco sul pulsante.
@MainActor @Observable
final class VisitedModel {
    private enum Mode { case guest, account }

    /// Id degli eventi segnati (ospite: id sul telefono; account: id canonici): accendono la pillola del dettaglio.
    private(set) var ids: Set<Int> = []
    /// Chiave naturale (fonte + NUL + id di fonte): riconosce lo stesso evento anche con un altro id del gruppo.
    private(set) var keys: Set<String> = []
    /// La lista dell'account (vuota da ospite); le statistiche la leggono da qui.
    private(set) var items: [VisitedItem] = []
    private var guestEntries: [DeviceEntry] = []
    /// Contatori per .sensoryFeedback: cambiano a ogni esito, anche uguale al precedente.
    private(set) var successCount = 0
    private(set) var warningCount = 0
    private(set) var errorCount = 0

    private var mode = Mode.guest
    private var guestStats: [VisitedStatItem] = []
    private let api: APIClient
    private let store: GuestStore
    private let show: @MainActor (Toast) -> Void

    init(api: APIClient, store: GuestStore = GuestStore(fileURL: GuestStore.visitedFileURL), show: @escaping @MainActor (Toast) -> Void) {
        self.api = api
        self.store = store
        self.show = show
    }

    /// Giorno di visita e categoria dei segni, per le statistiche (27.1-10). Ospite: le voci del telefono; account: la lista.
    var statItems: [VisitedStatItem] {
        switch mode {
        case .guest: guestStats
        case .account: items.map { VisitedStatItem(visitDay: $0.visitDay, category: $0.snap.category) }
        }
    }

    /// All'avvio, prima di Session.restore: i segni del telefono partono accesi senza aspettare la rete.
    func start() async {
        await loadGuest()
    }

    private func loadGuest() async {
        let entries = await store.all()
        guestEntries = entries
        ids = Set(entries.map(\.id))
        keys = Set(entries.compactMap { $0.snap.map { Self.key($0.source, $0.sourceId) } })
        guestStats = entries.compactMap { e in
            e.visitDay.map { VisitedStatItem(visitDay: $0, category: e.snap?.category) }
        }
    }

    private func say(_ message: String) { show(Toast(message: message)) }

    private static func key(_ source: String, _ sourceId: String) -> String { "\(source)\u{0}\(sourceId)" }

    private func key(_ event: Event) -> String? {
        guard let source = event.source, let sourceId = event.sourceId else { return nil }
        return Self.key(source, sourceId)
    }

    func isVisited(_ event: Event) -> Bool {
        ids.contains(event.id) || (key(event).map(keys.contains) ?? false)
    }

    /// D-02: il giorno di visita di oggi (Roma) per questo evento, o nil se non e' ancora iniziato (niente pillola).
    func visitDay(for event: Event) -> String? {
        visitDayFor(dateStart: event.dateStart, dateEnd: event.dateEnd, today: romeToday())
    }

    /// Ottimistico: la pillola cambia subito e torna indietro se il segno non riesce.
    func toggle(_ event: Event) async {
        guard let day = visitDay(for: event) else { return }
        let was = isVisited(event)
        let k = key(event)
        if was { ids.remove(event.id); if let k { keys.remove(k) } } else { ids.insert(event.id); if let k { keys.insert(k) } }
        switch mode {
        case .guest:
            // D-05: il giorno si decide qui, al tocco, e resta quello.
            if await store.toggle(id: event.id, snap: Snap(event: event), now: .now, visitDay: day) == .cap {
                ids.remove(event.id)
                if let k { keys.remove(k) }
                warningCount += 1
                say(Copy.guestCap)
            } else if !was {
                successCount += 1
            }
            await loadGuest()
        case .account:
            do {
                if was { try await api.unmarkVisited(id: event.id) } else { try await api.markVisited(id: event.id) }
                if !was { successCount += 1 }
                await reloadAccount()
            } catch {
                if was { ids.insert(event.id); if let k { keys.insert(k) } } else { ids.remove(event.id); if let k { keys.remove(k) } }
                fail(error)
            }
        }
    }

    private func fail(_ error: Error) {
        switch error {
        case APIError.http(401, _):
            break  // la sessione e' finita: ci pensa Session.handleUnauthorized
        case APIError.http(let status, let code) where status == 409 && code == "cap":
            warningCount += 1
            say(Copy.accountCap)
        default:
            errorCount += 1
            say(Copy.failed)
        }
    }

    // MARK: Salvati (27.1-10)

    /// Le righe del chip "Visitati": stesso tipo di Salvati, prefisso "v". Una riga di evento sparito non si apre (eventID nil).
    var rows: [SavedRow] {
        switch mode {
        case .guest:
            guestEntries.compactMap { e in e.snap.map { SavedRow(entryID: e.id, eventID: e.id, snap: $0, gone: false, prefix: "v") } }
        case .account:
            items.map { i in
                var snap = i.snap
                snap.imageUrl = i.imageUrl ?? snap.imageUrl
                return SavedRow(entryID: i.ref, eventID: i.eventId, snap: snap, gone: i.eventId == nil, prefix: "v")
            }
        }
    }

    /// Il giorno di visita di ogni riga (id della riga -> "YYYY-MM-DD"), quello fissato al tocco.
    var visitDays: [String: String] {
        switch mode {
        case .guest: Dictionary(guestEntries.compactMap { e in e.visitDay.map { ("v\(e.id)", $0) } }, uniquingKeysWith: { a, _ in a })
        case .account: Dictionary(items.map { ("v\($0.ref)", $0.visitDay) }, uniquingKeysWith: { a, _ in a })
        }
    }

    /// Via senza dialogo (reversibile): la riga se ne va subito, "Annulla" per 4 secondi rimette la stessa voce o rifa' il segno.
    func remove(_ row: SavedRow) async {
        let message = String(localized: "Rimosso dai visitati")
        switch mode {
        case .guest:
            let entry = guestEntries.first { $0.id == row.entryID }
            await store.remove(row.entryID)
            await loadGuest()
            if let entry {
                undoToast(message) { [store] in await store.restore(entry); await self.loadGuest() }
            } else {
                say(message)
            }
        case .account:
            let before = items
            apply(items.filter { $0.ref != row.entryID })
            do {
                if let id = row.eventID { try await api.unmarkVisited(id: id) } else { try await api.unmarkVisitedGone(ref: row.entryID) }
                writeCache()
                // Una riga sparita non si puo' rimarcare (l'evento non c'e' piu'): niente "Annulla".
                if let id = row.eventID {
                    undoToast(message) { [api] in _ = try? await api.markVisited(id: id); await self.reloadAccount() }
                } else {
                    say(message)
                }
            } catch {
                apply(before)
                fail(error)
            }
        }
    }

    private func undoToast(_ message: String, undo: @escaping @MainActor () async -> Void) {
        show(Toast(message: message, actionTitle: String(localized: "Annulla"), action: { Task { await undo() } }))
    }

    /// La riga di Salvati e' segnata? Ospite: l'id della riga e' quello dell'evento; in ogni caso vale la chiave naturale.
    func isVisited(row: SavedRow) -> Bool {
        (mode == .guest && ids.contains(row.entryID)) || (row.sourceKey.map(keys.contains) ?? false)
    }

    /// D-03: un tocco sulla riga dei Passati segna, il secondo toglie. Il salvato non si tocca mai (D-04).
    func toggleFromSaved(_ row: SavedRow) async {
        let was = isVisited(row: row)
        let k = row.sourceKey
        switch mode {
        case .guest:
            // Senza istantanea sul telefono non c'e' nulla da conservare (RESEARCH, domanda 6).
            guard let snap = row.snap else { errorCount += 1; say(Copy.failed); return }
            var day: String?
            if !was {
                day = visitDayFor(dateStart: snap.dateStart, dateEnd: snap.dateEnd, today: romeToday())
                guard day != nil else { errorCount += 1; say(Copy.failed); return }
            }
            ids.formSymmetricDifference([row.entryID])
            if await store.toggle(id: row.entryID, snap: snap, now: .now, visitDay: day) == .cap {
                warningCount += 1
                say(Copy.guestCap)
            } else if !was {
                successCount += 1
            }
            await loadGuest()
        case .account:
            // La voce visitata di questo evento, se c'e': serve a toglierla (viva per id, sparita per ref).
            let item = k.flatMap { k in items.first { Self.key($0.snap.source, $0.snap.sourceId) == k } }
            if was { if let k { keys.remove(k) } } else if let k { keys.insert(k) }
            do {
                if !was {
                    try await api.markVisitedFromSaved(ref: row.entryID)
                } else if let id = item?.eventId ?? row.eventID {
                    try await api.unmarkVisited(id: id)
                } else if let item {
                    try await api.unmarkVisitedGone(ref: item.ref)
                } else {
                    throw APIError.decoding
                }
                if !was { successCount += 1 }
                await reloadAccount()
            } catch {
                if was { if let k { keys.insert(k) } } else if let k { keys.remove(k) }
                fail(error)
            }
        }
    }

    /// Dopo un accesso riuscito (e dopo restore): unisce i segni del telefono, poi passa all'account.
    func didSignIn() async {
        let api = api
        switch await mergeGuestSaves(store: store, send: { try await api.mergeVisited($0) }) {
        case .nothing:
            break
        case .merged(let added):
            if let message = mergeVisitedMessage(added: added) {
                successCount += 1
                say(message)
            }
        case .failed:
            // I segni restano sul telefono: la riprova e' il prossimo didSignIn.
            errorCount += 1
            say(Copy.failed)
        }
        mode = .account
        guestStats = []
        await reloadAccount()
    }

    /// Uscita, sessione scaduta o account eliminato: sul telefono non resta nulla (T-27-33, T-27.1-28).
    func didSignOut() async {
        await store.clear()
        guestStats = []
        ids = []
        keys = []
        items = []
        mode = .guest
        try? FileManager.default.removeItem(at: Self.cacheURL)
    }

    /// Tirare per aggiornare in Visitati: la lista dell'account, o i segni del telefono.
    func reload() async {
        switch mode {
        case .guest: await loadGuest()
        case .account: await reloadAccount()
        }
    }

    private func reloadAccount() async {
        do {
            apply(try await api.visitedList())
            writeCache()
        } catch {
            if case APIError.http(401, _) = error { return }  // la sessione e' finita: ci pensa Session
            // Senza rete restano gli ultimi segni conosciuti; senza nemmeno quelli, nessun segno (mai quelli di un altro account).
            apply(readCache() ?? [])
        }
    }

    private func apply(_ list: [VisitedItem]) {
        items = list
        ids = Set(list.compactMap(\.eventId))
        keys = Set(list.map { Self.key($0.snap.source, $0.snap.sourceId) })
    }

    /// Ultima lista dell'account, per le statistiche offline. Sparisce con l'uscita (T-27.1-28).
    static var cacheURL: URL { URL.cachesDirectory.appending(path: "fuorirotta/visitati.json") }

    private func writeCache() {
        // ponytail: scrittura fallita = niente cache offline, nient'altro.
        try? FileManager.default.createDirectory(at: Self.cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: Self.cacheURL, options: .atomic) }
    }

    private func readCache() -> [VisitedItem]? {
        guard let data = try? Data(contentsOf: Self.cacheURL) else { return nil }
        return try? JSONDecoder().decode([VisitedItem].self, from: data)
    }
}
