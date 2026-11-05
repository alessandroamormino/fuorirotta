import Foundation
import Testing
@testable import FuorirottaCore

private func tempFile() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("gs-\(UUID().uuidString)/fuorirotta/saves.json")
}

private func visitedFile() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("gs-\(UUID().uuidString)/fuorirotta/visited.json")
}

private func snap(_ n: Int) -> Snap {
    Snap(title: "Evento \(n)", dateStart: "2026-11-08T00:00:00.000Z", dateEnd: nil, place: nil, category: "Altro", source: "s", sourceId: "\(n)", sourceUrl: nil)
}

private func at(_ n: Int) -> Date { Date(timeIntervalSince1970: 1_790_000_000 + Double(n)) }

@Suite struct GuestStoreTests {
    @Test func capIsHundredAndRemovalWorksAtTheCap() async {
        let store = GuestStore(fileURL: tempFile())
        for i in 1...100 { #expect(await store.toggle(id: i, snap: nil, now: at(i)) == .added) }
        #expect(await store.toggle(id: 101, snap: nil, now: at(101)) == .cap)
        #expect(await store.toggle(id: 50, snap: nil, now: at(102)) == .removed)
        #expect(await store.all().count == 99)
        #expect(await store.toggle(id: 101, snap: nil, now: at(103)) == .added)
    }

    @Test func concurrentTogglesNeverExceedTheCap() async {
        let store = GuestStore(fileURL: tempFile())
        let results = await withTaskGroup(of: ToggleResult.self) { group in
            for i in 1...120 { group.addTask { await store.toggle(id: i, snap: nil, now: at(i)) } }
            return await group.reduce(into: []) { $0.append($1) }
        }
        #expect(results.filter { $0 == .cap }.count == 20)
        #expect(await store.all().count == 100)
    }

    @Test func reopenedStoreReadsTheSameEntriesNewestFirst() async {
        let file = tempFile()
        let a = GuestStore(fileURL: file)
        _ = await a.toggle(id: 1, snap: snap(1), now: at(1))
        _ = await a.toggle(id: 2, snap: nil, now: at(2))
        _ = await a.toggle(id: 3, snap: nil, now: at(3))
        let b = GuestStore(fileURL: file)
        #expect(await b.all() == a.all())
        #expect(await b.all().map(\.id) == [3, 2, 1])
        #expect(await b.contains(1))
        #expect(await b.contains(9) == false)
    }

    @Test func setSnapAndRemove() async {
        let store = GuestStore(fileURL: tempFile())
        _ = await store.toggle(id: 7, snap: nil, now: at(1))
        await store.setSnap(7, snap(7))
        #expect(await store.all().first?.snap?.title == "Evento 7")
        await store.remove(7)
        #expect(await store.all().isEmpty)
    }

    @Test func mergePayloadHasExactlyTheAcceptedKeysAndSurvivesUntilClear() async throws {
        let store = GuestStore(fileURL: tempFile())
        _ = await store.toggle(id: 1, snap: snap(1), now: at(1))
        _ = await store.toggle(id: 2, snap: nil, now: at(2))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(await store.mergePayload())) as! [[String: Any]]
        #expect(Set(json[0].keys) == ["id", "savedAt"])
        #expect(Set(json[1].keys) == ["id", "savedAt", "snap"])
        #expect(json[1]["savedAt"] as? String == iso(at(1)))
        #expect(await store.mergePayload().count == 2)
        await store.clear()
        #expect(await store.mergePayload().isEmpty)
    }

    @Test func photoIsKeptOnThePhoneButNeverSentToTheServer() async throws {
        let file = tempFile()
        var s = snap(1)
        s.imageUrl = "https://x.test/f.jpg"
        let a = GuestStore(fileURL: file)
        _ = await a.toggle(id: 1, snap: s, now: at(1))
        #expect(await GuestStore(fileURL: file).all().first?.snap?.imageUrl == "https://x.test/f.jpg")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(await a.mergePayload())) as! [[String: Any]]
        #expect(Set((json[0]["snap"] as! [String: Any]).keys) == ["title", "dateStart", "category", "source", "sourceId"])
        #expect(await a.all().first?.snap?.imageUrl != nil)
    }

    @Test func corruptFileIsKeptAside() async throws {
        let file = tempFile()
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{non json".utf8).write(to: file)
        let store = GuestStore(fileURL: file)
        #expect(await store.all().isEmpty)
        let names = try FileManager.default.contentsOfDirectory(atPath: file.deletingLastPathComponent().path)
        #expect(names.contains { $0.hasPrefix("saves.corrupt-") && $0.hasSuffix(".json") })
        _ = await store.toggle(id: 1, snap: nil, now: at(1))
        #expect(try Data(contentsOf: file).count > 2)
    }

    @Test func savesEntryHasNoVisitDayKeyAndVisitedEntryKeepsIt() async throws {
        let saves = GuestStore(fileURL: tempFile())
        _ = await saves.toggle(id: 1, snap: snap(1), now: at(1))
        let savesJson = try JSONSerialization.jsonObject(with: JSONEncoder().encode(await saves.all())) as! [[String: Any]]
        #expect(savesJson[0]["visitDay"] == nil)

        let file = visitedFile()
        let a = GuestStore(fileURL: file)
        _ = await a.toggle(id: 2, snap: snap(2), now: at(2), visitDay: "2026-11-01")
        #expect(await GuestStore(fileURL: file).all().first?.visitDay == "2026-11-01")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(await a.mergePayload())) as! [[String: Any]]
        #expect(Set(json[0].keys) == ["id", "savedAt", "visitDay", "snap"])
    }

    @Test func corruptVisitedFileIsSetAsideUnderItsOwnNameAndSavesAreUntouched() async throws {
        let saves = tempFile()
        let a = GuestStore(fileURL: saves)
        _ = await a.toggle(id: 1, snap: nil, now: at(1))
        let before = try Data(contentsOf: saves)
        // Stessa cartella dei salvati, come sul telefono.
        let visited = saves.deletingLastPathComponent().appendingPathComponent("visited.json")
        try Data("{non json".utf8).write(to: visited)
        #expect(await GuestStore(fileURL: visited).all().isEmpty)
        let names = try FileManager.default.contentsOfDirectory(atPath: saves.deletingLastPathComponent().path)
        #expect(names.contains { $0.hasPrefix("visited.corrupt-") && $0.hasSuffix(".json") })
        #expect(!names.contains { $0.hasPrefix("saves.corrupt-") })
        #expect(try Data(contentsOf: saves) == before)
    }

    @Test func visitedCapIsStillHundred() async {
        let store = GuestStore(fileURL: visitedFile())
        for i in 1...100 { #expect(await store.toggle(id: i, snap: nil, now: at(i), visitDay: "2026-11-01") == .added) }
        #expect(await store.toggle(id: 101, snap: nil, now: at(101), visitDay: "2026-11-01") == .cap)
    }
}

private func iso(_ d: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: d)
}
