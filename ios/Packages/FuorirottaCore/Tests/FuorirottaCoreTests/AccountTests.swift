import Foundation
import Testing
@testable import FuorirottaCore

extension MeTests {
    @Suite struct Account {
        @Test func displayNameFollowsTheServerRule() {
            #expect(normalizedDisplayName("  Ada Lovelace \n") == "Ada Lovelace")
            #expect(normalizedDisplayName("") == nil)
            #expect(normalizedDisplayName("   ") == nil)
            // 50 punti di codice si', 51 no; un'emoji con selettore conta come due, come in Postgres.
            #expect(normalizedDisplayName(String(repeating: "a", count: 50)) != nil)
            #expect(normalizedDisplayName(String(repeating: "a", count: 51)) == nil)
            #expect(normalizedDisplayName(String(repeating: "😀", count: 50)) != nil)
            #expect(normalizedDisplayName(String(repeating: "❤️", count: 25)) != nil)
            #expect(normalizedDisplayName(String(repeating: "❤️", count: 26)) == nil)
            // NFC: "e" + accento combinante diventa un solo punto di codice.
            #expect(normalizedDisplayName("Jose\u{301}")?.unicodeScalars.count == 4)
            // Controllo (NUL, a capo in mezzo) e override bidirezionale: rifiutati.
            #expect(normalizedDisplayName("a\u{0}b") == nil)
            #expect(normalizedDisplayName("a\nb") == nil)
            #expect(normalizedDisplayName("abc\u{202E}def") == nil)
            #expect(normalizedDisplayName("x\u{2066}y") == nil)
        }

        @Test func renameIsPatchWithTheNameInTheBody() async throws {
            MeStub.reset([.init(body: #"{"name":"Ada"}"#)])
            #expect(try await MeStub.client().renameProfile("Ada") == "Ada")
            let sent = try #require(MeStub.requests.first)
            #expect(sent.method == "PATCH" && sent.url.path == "/api/v1/me/profile")
            #expect(MeStub.json(sent) as? [String: String] == ["name": "Ada"])
        }

        @Test func renameRejectedIs400() async {
            MeStub.reset([.init(status: 400, body: #"{"error":"Nome non valido"}"#)])
            await #expect(throws: APIError.http(status: 400, code: "Nome non valido")) { try await MeStub.client().renameProfile("x") }
        }

        @Test func sessionsDecodeTheServerRows() async throws {
            MeStub.reset([.init(body: #"{"sessions":[{"id":"abc","device":"App iPhone","kind":"phone","createdAt":"2026-10-01T08:00:00.000Z","lastActive":"2026-11-02T09:30:00.000Z","expiresAt":"2026-12-31T08:00:00.000Z","current":true},{"id":"x_Y-2","device":"Safari su Mac","kind":"desktop","createdAt":"2026-09-01T08:00:00.000Z","lastActive":"2026-10-30T18:00:00Z","expiresAt":"2026-11-30T08:00:00.000Z","current":false}]}"#)])
            let rows = try await MeStub.client().sessions()
            #expect(rows.map(\.id) == ["abc", "x_Y-2"])
            #expect(rows.map(\.current) == [true, false])
            #expect(rows[1].kind == "desktop")
            #expect(rows[0].lastActive == ISO8601DateFormatter().date(from: "2026-11-02T09:30:00Z"))
            #expect(MeStub.requests.first?.method == "GET")
        }

        @Test func revokeOneUsesThePathAndRevokeOthersTheCollection() async throws {
            MeStub.reset([.init(body: #"{"revoked":1}"#), .init(body: #"{"revoked":3}"#)])
            let api = MeStub.client()
            try await api.revokeSession(id: "x_Y-2")
            #expect(try await api.revokeOtherSessions() == 3)
            #expect(MeStub.requests.map(\.method) == ["DELETE", "DELETE"])
            #expect(MeStub.requests.map(\.url.path) == ["/api/v1/me/sessions/x_Y-2", "/api/v1/me/sessions"])
        }

        @Test func aSessionIdWithAnotherShapeNeverLeaves() async {
            MeStub.reset([])
            for bad in ["../export", "a/b", "", String(repeating: "a", count: 65), "a b"] {
                await #expect(throws: APIError.http(status: 404, code: "not-found")) { try await MeStub.client().revokeSession(id: bad) }
            }
            #expect(MeStub.requests.isEmpty)
        }

        @Test func exportKeepsTheBytesAndTheServerFileName() async throws {
            let json = "{\n  \"format\": 1\n}"
            MeStub.reset([.init(body: json, headers: ["Content-Disposition": #"attachment; filename="fuorirotta-dati-2026-11-02.json""#])])
            let (data, name) = try await MeStub.client().exportData()
            #expect(String(decoding: data, as: UTF8.self) == json)
            #expect(name == "fuorirotta-dati-2026-11-02.json")
            #expect(MeStub.requests.first?.headers["Authorization"] == "Bearer b.sig")
        }

        @Test func exportFileNameFallsBackToTheRomeDay() {
            // 23:30 UTC del 1 novembre = gia' il 2 a Roma.
            let now = ISO8601DateFormatter().date(from: "2026-11-01T23:30:00Z")!
            #expect(exportFileName(disposition: nil, now: now) == "fuorirotta-dati-2026-11-02.json")
            #expect(exportFileName(disposition: "attachment; filename=\"../../etc/passwd\"", now: now) == "fuorirotta-dati-2026-11-02.json")
            #expect(exportFileName(disposition: "attachment; filename=dati.json", now: now) == "dati.json")
        }
    }
}
