import Foundation
import Testing
@testable import FuorirottaCore

// Stub proprio: le suite girano in parallelo e lo stato statico non si condivide con le altre.
final class ProfileStub: URLProtocol, @unchecked Sendable {
    struct Sent { let method: String; let url: URL; let headers: [String: String]; let body: Data }
    struct Reply { var status = 200; var body = "{}" }

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
            Self.sent.append(Sent(method: request.httpMethod ?? "", url: request.url!, headers: request.allHTTPHeaderFields ?? [:], body: body))
            return Self.replies.isEmpty ? Reply() : Self.replies.removeFirst()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private func client() -> APIClient {
    let api = APIClient(
        baseURL: URL(string: "https://example.test")!, appVersion: "1.0.0",
        session: APIClient.makeSession(appVersion: "1.0.0", protocolClasses: [ProfileStub.self]))
    api.bearer = "b.sig"
    return api
}

private func body(_ sent: ProfileStub.Sent) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: sent.body)) as? [String: Any] ?? [:]
}

@Suite(.serialized) struct ProfileTests {
    @Test func apnsHexIsLowercaseAndFullLength() {
        #expect(apnsHex(Data([0xAB, 0x01])) == "ab01")
        let token = apnsHex(Data((0..<32).map { UInt8(truncatingIfNeeded: $0 * 9 + 250) }))
        #expect(token.count == 64)
        #expect(token.range(of: ApiContract.apnsTokenPattern, options: .regularExpression) != nil)
        #expect(token == token.lowercased())
    }

    @Test func registerDeviceIsPutWithTokenInBodyOnly() async throws {
        ProfileStub.reset([.init()])
        let token = String(repeating: "ab", count: 32)
        try await client().registerDevice(token: token, environment: "sandbox", appVersion: "1.0.0")
        let sent = try #require(ProfileStub.requests.first)
        #expect(sent.method == "PUT")
        #expect(sent.url.path == "/api/v1/me/devices")
        #expect(sent.url.query == nil)
        #expect(!sent.url.absoluteString.contains(token))
        #expect(sent.headers["Authorization"] == "Bearer b.sig")
        let json = body(sent)
        #expect(json["token"] as? String == token)
        #expect(json["environment"] as? String == "sandbox")
        #expect(json["appVersion"] as? String == "1.0.0")
    }

    @Test func registerDeviceFailureThrows() async {
        ProfileStub.reset([.init(status: 400, body: #"{"error":"bad-request"}"#)])
        await #expect(throws: APIError.http(status: 400, code: "bad-request")) {
            try await client().registerDevice(token: "zz", environment: "production", appVersion: "1.0.0")
        }
    }

    @Test func unregisterDeviceIsDeleteWithBody() async throws {
        ProfileStub.reset([.init()])
        let token = String(repeating: "0f", count: 32)
        try await client().unregisterDevice(token: token)
        let sent = try #require(ProfileStub.requests.first)
        #expect(sent.method == "DELETE")
        #expect(sent.url.path == "/api/v1/me/devices")
        #expect(!sent.url.absoluteString.contains(token))
        #expect(sent.headers["Authorization"] == "Bearer b.sig")
        #expect(body(sent).count == 1 && body(sent)["token"] as? String == token)
    }

    @Test func deleteUserIsPostWithEmptyObjectAndBearer() async throws {
        ProfileStub.reset([.init()])
        try await client().deleteUser()
        let sent = try #require(ProfileStub.requests.first)
        #expect(sent.method == "POST")
        #expect(sent.url.path == "/api/auth/delete-user")
        #expect(sent.headers["Authorization"] == "Bearer b.sig")
        #expect(body(sent).isEmpty)
        #expect(!sent.body.isEmpty)
    }

    @Test func deleteUserFailureThrowsAndNothingIsHidden() async {
        ProfileStub.reset([.init(status: 500, body: "{}")])
        await #expect(throws: APIError.http(status: 500, code: nil)) { try await client().deleteUser() }
    }
}
