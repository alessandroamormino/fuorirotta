import Foundation
import Testing
@testable import FuorirottaCore

// Risposta finta a tutte le richieste dell'APIClient: registra cio' che e' partito (metodo, percorso, header, corpo).
final class StubProtocol: URLProtocol, @unchecked Sendable {
    struct Sent { let method: String; let path: String; let headers: [String: String]; let body: Data }
    struct Reply { var status = 200; var headers: [String: String] = [:]; var body = "{}" }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var replies: [Reply] = []
    nonisolated(unsafe) private static var sent: [Sent] = []

    static func reset(_ r: [Reply]) { lock.withLock { replies = r; sent = [] } }
    static var requests: [Sent] { lock.withLock { sent } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                body.append(buf, count: n)
            }
            stream.close()
        }
        let reply: Reply = Self.lock.withLock {
            Self.sent.append(Sent(
                method: request.httpMethod ?? "", path: request.url?.path ?? "",
                headers: request.allHTTPHeaderFields ?? [:], body: body))
            return Self.replies.isEmpty ? Reply() : Self.replies.removeFirst()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private func stubbedClient() -> APIClient {
    APIClient(
        baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
        session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [StubProtocol.self]))
}

private func json(_ d: Data) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
}

@Suite(.serialized) struct AuthTests {
    @Test func sha256OfAbc() {
        #expect(sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func nonceIsFreshBase64urlOf32Bytes() {
        let a = randomNonce(), b = randomNonce()
        #expect(a != b)
        #expect(a.count == 43)  // 32 byte in base64url senza padding
        #expect(a.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    }

    @Test func appleBodyWithName() async throws {
        StubProtocol.reset([.init(headers: ["set-auth-token": "tok.sig"])])
        let bearer = try await stubbedClient().signInSocial(
            provider: "apple", idToken: "IDT", nonce: "RAW", firstName: "Ada", lastName: "Lovelace")
        #expect(bearer == "tok.sig")
        let sent = try #require(StubProtocol.requests.first)
        #expect(sent.method == "POST" && sent.path == "/api/auth/sign-in/social")
        let body = json(sent.body)
        #expect(body["provider"] as? String == "apple")
        let idToken = try #require(body["idToken"] as? [String: Any])
        #expect(idToken["token"] as? String == "IDT" && idToken["nonce"] as? String == "RAW")
        let name = ((idToken["user"] as? [String: Any])?["name"]) as? [String: String]
        #expect(name == ["firstName": "Ada", "lastName": "Lovelace"])
    }

    @Test func appleBodyWithoutNameHasNoUser() async throws {
        StubProtocol.reset([.init(headers: ["set-auth-token": "tok.sig"])])
        _ = try await stubbedClient().signInSocial(
            provider: "apple", idToken: "IDT", nonce: "RAW", firstName: nil, lastName: nil)
        let sent = try #require(StubProtocol.requests.first)
        let idToken = try #require(json(sent.body)["idToken"] as? [String: Any])
        #expect(idToken["user"] == nil)
    }

    @Test func googleBody() async throws {
        StubProtocol.reset([.init(headers: ["set-auth-token": "g.sig"])])
        let bearer = try await stubbedClient().signInSocial(
            provider: "google", idToken: "GID", nonce: "RAW", firstName: nil, lastName: nil)
        #expect(bearer == "g.sig")
        let sent = try #require(StubProtocol.requests.first)
        let body = json(sent.body)
        #expect(body["provider"] as? String == "google")
        #expect((body["idToken"] as? [String: Any])?["nonce"] as? String == "RAW")
    }

    @Test func missingTokenHeader() async {
        StubProtocol.reset([.init()])
        await #expect(throws: APIError.http(status: 200, code: "no-token")) {
            try await stubbedClient().signInSocial(provider: "apple", idToken: "x", nonce: "n", firstName: nil, lastName: nil)
        }
    }

    @Test func errorCodeComesFromBody() async {
        StubProtocol.reset([.init(status: 401, body: #"{"code":"ACCOUNT_NOT_LINKED","message":"x"}"#)])
        await #expect(throws: APIError.http(status: 401, code: "ACCOUNT_NOT_LINKED")) {
            try await stubbedClient().signInSocial(provider: "google", idToken: "x", nonce: "n", firstName: nil, lastName: nil)
        }
    }

    @Test func neverSendsCookieEvenAfterSetCookie() async throws {
        StubProtocol.reset([.init(headers: ["Set-Cookie": "better-auth.session_token=abc; Path=/"]), .init()])
        let api = stubbedClient()
        _ = try? await api.signInSocial(provider: "apple", idToken: "x", nonce: "n", firstName: nil, lastName: nil)
        api.bearer = "b.sig"
        _ = try? await api.meState()
        let all = StubProtocol.requests
        #expect(all.count == 2)
        #expect(all.allSatisfy { $0.headers.keys.allSatisfy { $0.lowercased() != "cookie" } })
    }

    @Test func authorizationOnlyOnPersonalRoutes() async throws {
        StubProtocol.reset([.init(), .init(body: #"{"enabled":true,"user":null}"#), .init(), .init(), .init(), .init()])
        let api = stubbedClient()
        api.bearer = "b.sig"
        _ = try? await api.events(lat: 45, lng: 9, radiusKm: 10, limit: 1)
        _ = try await api.meState()
        try await api.signOut()
        try await api.appleToken(code: "CODE")
        _ = try? await api.signInSocial(provider: "apple", idToken: "x", nonce: "n", firstName: nil, lastName: nil)
        let sent = StubProtocol.requests
        func auth(_ i: Int) -> String? { sent[i].headers.first { $0.key.lowercased() == "authorization" }?.value }
        #expect(auth(0) == nil)              // GET /api/events: pubblica
        #expect(auth(1) == "Bearer b.sig")   // GET /api/v1/me/state
        #expect(auth(2) == "Bearer b.sig")   // POST /api/auth/sign-out
        #expect(auth(3) == "Bearer b.sig")   // POST /api/v1/me/apple-token
        #expect(auth(4) == nil)              // POST /api/auth/sign-in/social: mai il bearer
        #expect(String(decoding: sent[2].body, as: UTF8.self) == "{}")  // corpo vuoto = 400 di Better Auth
        #expect(json(sent[3].body)["authorizationCode"] as? String == "CODE")
    }

    @Test func unauthorizedFromBearerRouteNotifies() async {
        StubProtocol.reset([.init(status: 401, body: #"{"error":"unauthorized"}"#)])
        let api = stubbedClient()
        api.bearer = "b.sig"
        let hits = Counter()
        api.onUnauthorized = { hits.bump() }
        _ = try? await api.meState()
        #expect(hits.value == 1)
    }

    // UAT 2: collegare un secondo metodo dalla sessione aperta (stesso /api/auth/link-social del sito, con id token).
    @Test func listAccountsIsGetWithBearer() async throws {
        StubProtocol.reset([.init(body: #"[{"id":"r1","providerId":"apple","accountId":"x","scopes":[]},{"id":"r2","providerId":"google"}]"#)])
        let api = stubbedClient()
        api.bearer = "b.sig"
        let rows = try await api.listAccounts()
        #expect(rows == [LinkedAccount(id: "r1", providerId: "apple"), LinkedAccount(id: "r2", providerId: "google")])
        let sent = try #require(StubProtocol.requests.first)
        #expect(sent.method == "GET" && sent.path == "/api/auth/list-accounts")
        #expect(sent.headers.first { $0.key.lowercased() == "authorization" }?.value == "Bearer b.sig")
    }

    @Test func linkSocialSendsProviderAndIdTokenWithBearer() async throws {
        StubProtocol.reset([.init(body: #"{"url":"","status":true,"redirect":false}"#)])
        let api = stubbedClient()
        api.bearer = "b.sig"
        try await api.linkSocial(provider: "google", idToken: "GID", nonce: "RAW")
        let sent = try #require(StubProtocol.requests.first)
        #expect(sent.method == "POST" && sent.path == "/api/auth/link-social")
        #expect(sent.headers.first { $0.key.lowercased() == "authorization" }?.value == "Bearer b.sig")
        let body = json(sent.body)
        #expect(body["provider"] as? String == "google")
        let token = try #require(body["idToken"] as? [String: Any])
        #expect(token["token"] as? String == "GID" && token["nonce"] as? String == "RAW")
        #expect(body["callbackURL"] == nil)  // nessun giro nel browser
    }

    @Test func unlinkAccountSendsRowIdWithBearer() async throws {
        StubProtocol.reset([.init(body: #"{"status":true}"#)])
        let api = stubbedClient()
        api.bearer = "b.sig"
        try await api.unlinkAccount(id: "r2")
        let sent = try #require(StubProtocol.requests.first)
        #expect(sent.method == "POST" && sent.path == "/api/auth/unlink-account")
        #expect(json(sent.body)["accountId"] as? String == "r2")
        #expect(sent.headers.first { $0.key.lowercased() == "authorization" }?.value == "Bearer b.sig")
    }

    @Test func rejectedIdTokenDoesNotLogTheUserOut() async {
        // Un id token non valido e' un 401 con il suo codice: la sessione dell'app e' a posto.
        StubProtocol.reset([.init(status: 401, body: #"{"code":"INVALID_TOKEN","message":"Invalid token"}"#)])
        let api = stubbedClient()
        api.bearer = "b.sig"
        let hits = Counter()
        api.onUnauthorized = { hits.bump() }
        await #expect(throws: APIError.http(status: 401, code: "INVALID_TOKEN")) {
            try await api.linkSocial(provider: "apple", idToken: "x", nonce: "n")
        }
        #expect(hits.value == 0)
    }

    @Test func expiredSessionOnLinkRouteStillNotifies() async {
        StubProtocol.reset([.init(status: 401, body: #"{"code":"UNAUTHORIZED","message":"Unauthorized"}"#)])
        let api = stubbedClient()
        api.bearer = "b.sig"
        let hits = Counter()
        api.onUnauthorized = { hits.bump() }
        _ = try? await api.listAccounts()
        #expect(hits.value == 1)
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    func bump() { lock.withLock { n += 1 } }
    var value: Int { lock.withLock { n } }
}
