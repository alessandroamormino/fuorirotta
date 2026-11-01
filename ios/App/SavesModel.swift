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

/// Avviso non bloccante in basso, sopra la barra delle schede (UI-SPEC: unione, tetti, rimozione).
struct Toast: Identifiable {
    let id = UUID()
    let message: String
    var actionTitle: String?
    var action: (@MainActor () -> Void)?
}

private enum Copy {
    static let failed = "Non è andata a buon fine. Riprova tra un momento."
    static let guestCap = "Hai raggiunto il limite di 100 salvati senza account. Accedi per salvarne fino a 500."
    static let accountCap = "Hai raggiunto il limite di 500 salvati. Rimuovine qualcuno per aggiungerne altri."
}

@MainActor @Observable
final class SavesModel {
    private enum Mode { case guest, account }

    /// Id salvati (ospite: id sul telefono; account: id canonici): accendono i segnalibri.
    private(set) var ids: Set<Int> = []
    private(set) var rows: [SavedRow] = []
    private(set) var loading = true
    /// Rete assente: si mostra l'ultima lista conosciuta con l'avviso "Sei offline...".
    private(set) var offline = false
    /// Rete assente e nessuna lista da mostrare.
    private(set) var loadFailed = false
    var toast: Toast?
    /// Contatori per .sensoryFeedback: cambiano a ogni esito, anche uguale al precedente.
    private(set) var successCount = 0
    private(set) var warningCount = 0
    private(set) var errorCount = 0
    /// Ospite con la lista piena a 90 o piu': l'intestazione di Salvati mostra "N di 100".
    var guestCount: Int? { mode == .guest ? ids.count : nil }

    /// Date e categorie dei salvati, per le statistiche (MOB-07). Ospite: le istantanee del telefono; account: le righe caricate.
    var statItems: [StatItem] {
        switch mode {
        case .guest: guestStats
        case .account: rows.filter { !$0.dateStart.isEmpty }.map { StatItem(dateStart: $0.dateStart, dateEnd: $0.dateEnd, category: $0.category) }
        }
    }

    private var guestStats: [StatItem] = []
    private var mode = Mode.guest
    private let api: APIClient
    private let store: GuestStore

    init(api: APIClient, store: GuestStore = GuestStore()) {
        self.api = api
        self.store = store
    }

    /// All'avvio, prima di Session.restore: i segnalibri partono accesi senza aspettare la rete.
    func start() async {
        ids = Set(await store.all().map(\.id))
        await refreshGuestStats()
    }

    private func refreshGuestStats() async {
        guestStats = await store.all().compactMap { e in
            e.snap.map { StatItem(dateStart: $0.dateStart, dateEnd: $0.dateEnd, category: $0.category) }
        }
    }

    func isSaved(_ id: Int) -> Bool { ids.contains(id) }

    func show(_ message: String) { toast = Toast(message: message) }

    /// Ottimistico: il segnalibro cambia subito e torna indietro se il salvataggio non riesce.
    func toggle(_ event: Event) async {
        let wasSaved = ids.contains(event.id)
        if wasSaved { ids.remove(event.id) } else { ids.insert(event.id) }
        switch mode {
        case .guest:
            if await store.toggle(id: event.id, snap: Snap(event: event), now: .now) == .cap {
                ids.remove(event.id)
                warningCount += 1
                show(Copy.guestCap)
            }
            await refreshGuestStats()
        case .account:
            do {
                if wasSaved { try await api.unsave(id: event.id) } else { try await api.save(id: event.id) }
            } catch {
                if wasSaved { ids.insert(event.id) } else { ids.remove(event.id) }
                switch error {
                case APIError.http(401, _):
                    break  // la sessione e' finita: ci pensa Session.handleUnauthorized
                case APIError.http(let status, let code) where status == 409 && code == "cap":
                    warningCount += 1
                    show(Copy.accountCap)
                default:
                    errorCount += 1
                    show(Copy.failed)
                }
            }
        }
    }

    /// Dopo un accesso riuscito (e dopo restore): unisce la lista del telefono, poi passa all'account.
    func didSignIn() async {
        let api = api
        switch await mergeGuestSaves(store: store, send: { try await api.merge($0) }) {
        case .nothing:
            break
        case .merged(let added):
            if let message = mergeMessage(added: added) {
                successCount += 1
                show(message)
            }
        case .failed:
            // La lista resta sul telefono: la riprova e' il prossimo didSignIn.
            errorCount += 1
            show(Copy.failed)
        }
        mode = .account
        if let saved = try? await api.savedIds() { ids = Set(saved) } else { ids = [] }
        rows = []
        loading = true
    }

    /// Uscita (o sessione scaduta): sul telefono non resta nulla dell'account (22 D-07, T-27-23).
    func didSignOut() async {
        await store.clear()
        guestStats = []
        ids = []
        rows = []
        mode = .guest
        loading = false
        offline = false
        loadFailed = false
        toast = nil
        try? FileManager.default.removeItem(at: Self.cacheURL)
    }

    /// Ospite: gli id del telefono, risolti dal server (POST, blocchi da 100). Account: la lista del server.
    func reload() async {
        switch mode {
        case .guest: await reloadGuest()
        case .account: await reloadAccount()
        }
        loading = false
    }

    /// Via senza dialogo (reversibile): la riga se ne va subito, l'avviso offre "Annulla" per 4 secondi.
    func remove(_ row: SavedRow, message: String) async {
        guard let index = rows.firstIndex(where: { $0.id == row.id }) else { return }
        rows.remove(at: index)
        let key = mode == .guest ? row.entryID : row.eventID  // lo stesso valore che accende il segnalibro
        if let key { ids.remove(key) }
        switch mode {
        case .guest:
            let entry = await store.all().first { $0.id == row.entryID }
            await store.remove(row.entryID)
            await refreshGuestStats()
            var undo: (@MainActor () async -> Void)?
            if let entry { undo = { [store] in await store.restore(entry) } }
            removedToast(message, undo: undo)
        case .account:
            do {
                if let id = row.eventID { try await api.unsave(id: id) } else { try await api.removeGone(ref: row.entryID) }
                // Una riga sparita non si puo' risalvare (l'evento non c'e' piu'): niente "Annulla".
                var undo: (@MainActor () async -> Void)?
                if let id = row.eventID { undo = { [api] in _ = try? await api.save(id: id) } }
                removedToast(message, undo: undo)
            } catch {
                rows.insert(row, at: min(index, rows.count))
                if let key { ids.insert(key) }
                if case APIError.http(401, _) = error { return }
                errorCount += 1
                show(Copy.failed)
            }
        }
    }

    private func removedToast(_ message: String, undo: (@MainActor () async -> Void)?) {
        guard let undo else {
            show(message)
            return
        }
        toast = Toast(message: message, actionTitle: "Annulla", action: {
            Task {
                await undo()
                await self.reload()
            }
        })
    }

    private func reloadGuest() async {
        let entries = await store.all()
        ids = Set(entries.map(\.id))
        await refreshGuestStats()
        if entries.isEmpty {
            rows = []
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
            offline = false
        } catch {
            // Senza rete restano le istantanee del telefono (non sappiamo se qualcuno e' sparito).
            rows = entries.map { SavedRow(entryID: $0.id, eventID: $0.id, snap: $0.snap, gone: false, prefix: "g") }
            offline = true
        }
    }

    private func reloadAccount() async {
        do {
            let items = try await api.savedList()
            rows = items.map {
                SavedRow(entryID: $0.ref, eventID: $0.eventId, snap: $0.live ?? $0.snap, gone: $0.eventId == nil, prefix: "a")
            }
            ids = Set(items.compactMap(\.eventId))
            offline = false
            loadFailed = false
            writeCache()
        } catch {
            if case APIError.http(401, _) = error { return }  // la sessione e' finita: ci pensa Session
            if let cached = readCache() {
                rows = cached
                offline = true
            } else if rows.isEmpty {
                loadFailed = true
            }
        }
    }

    /// Ultima lista dell'account mostrata, per quando la rete manca. Sparisce con l'uscita (T-27-23).
    static var cacheURL: URL { URL.cachesDirectory.appending(path: "fuorirotta/salvati.json") }

    private func writeCache() {
        // ponytail: scrittura fallita = niente cache offline, nient'altro.
        try? FileManager.default.createDirectory(at: Self.cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(rows) { try? data.write(to: Self.cacheURL, options: .atomic) }
    }

    private func readCache() -> [SavedRow]? {
        guard let data = try? Data(contentsOf: Self.cacheURL) else { return nil }
        return try? JSONDecoder().decode([SavedRow].self, from: data)
    }
}
