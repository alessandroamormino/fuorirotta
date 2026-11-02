import Foundation
import Testing
@testable import FuorirottaCore

extension MeTests {
    @Suite struct Sharing {
        private let prod = URL(string: "https://fuori-rotta.it")!
        private let local = URL(string: "http://mac.local:3000")!

        @Test func shareURLIsTheSitePlusThePath() {
            #expect(shareURL(base: prod, path: "/l/abc_DEF-123")?.absoluteString == "https://fuori-rotta.it/l/abc_DEF-123")
            #expect(shareURL(base: URL(string: "https://fuori-rotta.it/")!, path: "/l/x")?.absoluteString == "https://fuori-rotta.it/l/x")
            // Solo un /l/<codice>: un altro percorso non diventa mai un indirizzo da condividere.
            for bad in ["/l/", "/cal/x.ics", "l/x", "//evil.example/l/x", "/l/x?y=1", "https://evil.example/l/x"] {
                #expect(shareURL(base: prod, path: bad) == nil, "\(bad)")
            }
        }

        @Test func webcalKeepsHostAndPort() {
            #expect(webcalURL(base: prod, path: "/cal/tok.ics")?.absoluteString == "webcal://fuori-rotta.it/cal/tok.ics")
            #expect(webcalURL(base: local, path: "/cal/tok.ics")?.absoluteString == "webcal://mac.local:3000/cal/tok.ics")
            #expect(feedURL(base: prod, path: "/cal/tok.ics")?.absoluteString == "https://fuori-rotta.it/cal/tok.ics")
            for bad in ["/cal/", "/l/x", "cal/x.ics", "/cal/x.ics#a"] {
                #expect(webcalURL(base: prod, path: bad) == nil, "\(bad)")
            }
        }

        @Test func stateReadsOnlyAndDecodesBothShapes() async throws {
            MeStub.reset([
                .init(body: #"{"link":null,"upcoming":0}"#),
                .init(body: #"{"link":{"path":"/l/abc","showName":true},"upcoming":3}"#),
            ])
            let api = MeStub.client()
            #expect(try await api.shareState() == ShareState(link: nil, upcoming: 0))
            #expect(try await api.shareState() == ShareState(link: ShareLinkInfo(path: "/l/abc", showName: true), upcoming: 3))
            #expect(MeStub.requests.map(\.method) == ["GET", "GET"])
            #expect(MeStub.requests.allSatisfy { $0.url.path == "/api/v1/me/share" && $0.headers["Authorization"] == "Bearer b.sig" })
        }

        @Test func createRotateDeleteAndName() async throws {
            MeStub.reset([
                .init(body: #"{"path":"/l/one","showName":false}"#),
                .init(body: #"{"path":"/l/two","showName":false}"#),
                .init(body: #"{"showName":true}"#),
                .init(body: #"{"removed":1}"#),
            ])
            let api = MeStub.client()
            #expect(try await api.createShareLink() == ShareLinkInfo(path: "/l/one", showName: false))
            #expect(try await api.rotateShareLink().path == "/l/two")
            #expect(try await api.setShareShowsName(true))
            try await api.deleteShareLink()
            let sent = MeStub.requests
            #expect(sent.map(\.method) == ["POST", "POST", "PATCH", "DELETE"])
            #expect(sent.map(\.url.path) == ["/api/v1/me/share", "/api/v1/me/share/rotate", "/api/v1/me/share", "/api/v1/me/share"])
            #expect(MeStub.json(sent[2]) as? [String: Bool] == ["showName": true])
        }

        @Test func rotateWithoutALinkIs404() async {
            MeStub.reset([.init(status: 404, body: #"{"error":"not-found"}"#)])
            await #expect(throws: APIError.http(status: 404, code: "not-found")) { try await MeStub.client().rotateShareLink() }
        }

        @Test func calendarFeedAndRotate() async throws {
            MeStub.reset([.init(body: #"{"path":"/cal/a.ics"}"#), .init(body: #"{"path":"/cal/b.ics"}"#)])
            let api = MeStub.client()
            #expect(try await api.calendarFeed() == "/cal/a.ics")
            #expect(try await api.rotateCalendarFeed() == "/cal/b.ics")
            #expect(MeStub.requests.map(\.url.path) == ["/api/v1/me/calendar-feed", "/api/v1/me/calendar-feed/rotate"])
            #expect(MeStub.requests.allSatisfy { $0.method == "POST" })
        }

        @Test func aMalformedReplyIsADecodingError() async {
            MeStub.reset([.init(body: #"{"nope":1}"#)])
            await #expect(throws: APIError.decoding) { try await MeStub.client().calendarFeed() }
        }
    }
}
