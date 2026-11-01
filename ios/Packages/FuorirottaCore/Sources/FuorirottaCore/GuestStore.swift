import Foundation

// Salvati senza account: un file sul telefono, tetto 100 come sul web (GUEST_CAP).
// Nessun codice di rete: la lista lascia il telefono solo dopo l'accesso, via POST /api/v1/me/saved/merge.

/// Specchio di Snap in lib/saved/snapshot.ts; i campi assenti non vengono scritti.
public struct Snap: Codable, Hashable, Sendable {
    public var title: String
    public var dateStart: String
    public var dateEnd: String?
    public var place: String?
    public var category: String
    public var source: String
    public var sourceId: String
    public var sourceUrl: String?
    public init(title: String, dateStart: String, dateEnd: String?, place: String?, category: String, source: String, sourceId: String, sourceUrl: String?) {
        self.title = title; self.dateStart = dateStart; self.dateEnd = dateEnd; self.place = place
        self.category = category; self.source = source; self.sourceId = sourceId; self.sourceUrl = sourceUrl
    }
}

public struct DeviceEntry: Codable, Hashable, Sendable {
    public var id: Int
    public var savedAt: String
    public var snap: Snap?
    public init(id: Int, savedAt: String, snap: Snap?) { self.id = id; self.savedAt = savedAt; self.snap = snap }
}

public enum ToggleResult: Sendable { case added, removed, cap }

public actor GuestStore {
    private let fileURL: URL
    private var entries: [DeviceEntry]?

    public init(fileURL: URL = GuestStore.defaultFileURL) { self.fileURL = fileURL }

    public static let defaultFileURL: URL = URL.applicationSupportDirectory.appending(path: "fuorirotta/saves.json")

    public func all() -> [DeviceEntry] { loaded() }
    public func contains(_ id: Int) -> Bool { loaded().contains { $0.id == id } }

    public func toggle(id: Int, snap: Snap?, now: Date) -> ToggleResult {
        var list = loaded()
        if let i = list.firstIndex(where: { $0.id == id }) {
            list.remove(at: i)
            commit(list)
            return .removed
        }
        guard list.count < ApiContract.guestCap else { return .cap }
        list.insert(DeviceEntry(id: id, savedAt: Self.iso(now), snap: snap), at: 0)
        commit(list)
        return .added
    }

    public func remove(_ id: Int) { commit(loaded().filter { $0.id != id }) }

    /// Toglie piu' id con una sola scrittura (dopo un'unione riuscita).
    public func remove(ids: Set<Int>) { commit(loaded().filter { !ids.contains($0.id) }) }

    /// Rimette una voce tolta (Annulla) con il suo istante e la sua posizione originali.
    public func restore(_ entry: DeviceEntry) {
        var list = loaded().filter { $0.id != entry.id }
        guard list.count < ApiContract.guestCap else { return }
        list.append(entry)
        commit(list.sorted { $0.savedAt > $1.savedAt })
    }

    public func setSnap(_ id: Int, _ snap: Snap) {
        var list = loaded()
        guard let i = list.firstIndex(where: { $0.id == id }) else { return }
        list[i].snap = snap
        commit(list)
    }

    /// Il corpo di POST /api/v1/me/saved/merge, campo items: invariato finche' non si chiama clear().
    public func mergePayload() -> [DeviceEntry] { loaded() }

    public func clear() { commit([]) }

    private func commit(_ list: [DeviceEntry]) {
        entries = list
        let dir = fileURL.deletingLastPathComponent()
        // ponytail: scrittura fallita = lista solo in memoria fino alla prossima modifica, che riscrive tutto il file.
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(list) { try? data.write(to: fileURL, options: .atomic) }
    }

    private func loaded() -> [DeviceEntry] {
        if let entries { return entries }
        var list: [DeviceEntry] = []
        if FileManager.default.fileExists(atPath: fileURL.path) {
            if let data = try? Data(contentsOf: fileURL), let decoded = try? JSONDecoder().decode([DeviceEntry].self, from: data) {
                list = decoded.sorted { $0.savedAt > $1.savedAt }
            } else {
                // Mai sovrascritto in silenzio (T-27-13): il file illeggibile resta accanto, la lista riparte vuota.
                let aside = fileURL.deletingLastPathComponent().appending(path: "saves.corrupt-\(Int(Date().timeIntervalSince1970)).json")
                try? FileManager.default.moveItem(at: fileURL, to: aside)
            }
        }
        entries = list
        return list
    }

    private static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}
