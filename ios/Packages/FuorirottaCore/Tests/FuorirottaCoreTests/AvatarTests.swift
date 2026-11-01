import Testing
@testable import FuorirottaCore

@Suite struct AvatarTests {
    @Test func twoWordsGiveTwoInitials() {
        #expect(initials(name: "Alessandro Amormino", email: "a@b.it") == "AA")
    }

    @Test func manyWordsUseFirstAndLast() {
        #expect(initials(name: "anna maria rossi", email: "a@b.it") == "AR")
    }

    @Test func oneWordGivesOneInitial() {
        #expect(initials(name: "mario", email: "x@y.it") == "M")
    }

    @Test func extraSpacesAreIgnored() {
        #expect(initials(name: "  Luca   Bianchi ", email: "x@y.it") == "LB")
    }

    @Test func emptyNameFallsBackToTheEmail() {
        #expect(initials(name: "  ", email: "zeta@y.it") == "Z")
    }

    @Test func nothingAtAllIsAQuestionMark() {
        #expect(initials(name: "", email: "") == "?")
    }

    @Test func accentedLettersStayWhole() {
        #expect(initials(name: "élodie Ñandú", email: "") == "ÉÑ")
    }

    @Test func stableIndexIsDeterministicAndInRange() {
        let a = stableIndex("Alessandro Amormino", count: 6)
        #expect(a == stableIndex("Alessandro Amormino", count: 6))
        #expect((0..<6).contains(a))
        #expect(stableIndex("", count: 6) == 0)
        // Valore fissato: la funzione non puo' cambiare tra una versione e l'altra (il colore dell'avatar non deve saltare).
        #expect(stableIndex("abc", count: 100) == 6)
    }
}
