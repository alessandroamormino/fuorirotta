import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct SignInMethodsTests {
    private func rows(_ ids: String...) -> [LinkedAccount] {
        ids.enumerated().map { LinkedAccount(id: "row\($0.offset)", providerId: $0.element) }
    }

    @Test func noAccountsMeansNothingLinked() {
        let m = SignInMethods(accounts: [])
        #expect(SignInProvider.allCases.allSatisfy { !m.isLinked($0) && !m.canUnlink($0) && m.accountId($0) == nil })
    }

    @Test func oneMethodCannotBeUnlinked() {
        let m = SignInMethods(accounts: rows("apple"))
        #expect(m.isLinked(.apple) && !m.isLinked(.google))
        #expect(!m.canUnlink(.apple))  // l'ultimo metodo resta sempre
    }

    @Test func twoMethodsCanBothBeUnlinked() {
        let m = SignInMethods(accounts: rows("apple", "google"))
        #expect(m.canUnlink(.apple) && m.canUnlink(.google))
        #expect(m.accountId(.google) == "row1")
    }

    @Test func anUnknownProviderStillCountsTowardsTheLastOne() {
        // Come il server: una riga qualunque basta perche' non sia l'ultima.
        let m = SignInMethods(accounts: rows("google", "credential"))
        #expect(m.canUnlink(.google))
        #expect(!m.isLinked(.apple))
    }

    @Test func notLinkedCanNeverBeUnlinked() {
        let m = SignInMethods(accounts: rows("google", "credential"))
        #expect(!m.canUnlink(.apple))
    }

    @Test func failureMessagesAreSpecificWhenTheServerIsSpecific() {
        func msg(_ status: Int, _ code: String?) -> String {
            linkFailureMessage(APIError.http(status: status, code: code), provider: .google)
        }
        #expect(msg(409, "SOCIAL_ACCOUNT_ALREADY_LINKED").contains("già collegato a un altro profilo"))
        #expect(msg(401, "LINKING_NOT_ALLOWED").contains("non ha confermato"))
        #expect(msg(429, nil).contains("Troppi tentativi"))
        #expect(msg(500, nil) == "Non è andata a buon fine. Riprova tra un momento.")
        #expect(linkFailureMessage(APIError.network, provider: .apple) == "Non è andata a buon fine. Riprova tra un momento.")
    }
}
