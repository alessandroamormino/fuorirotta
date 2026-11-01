import Foundation
import Testing
@testable import FuorirottaCore

// Descrizioni come le manda il server (in-lombardia: <p>, <br>, <strong>, &nbsp;), convertite in testo
// con formattazione minima. Solo testo: niente script, niente immagini, solo link http/https.

private func plain(_ html: String) -> String { String(htmlToAttributed(html).characters) }

private func intents(_ a: AttributedString, of word: String) -> InlinePresentationIntent? {
    a.runs.first { String(a[$0.range].characters).contains(word) }?.inlinePresentationIntent
}

private func links(_ a: AttributedString) -> [String: String] {
    var out: [String: String] = [:]
    for run in a.runs { if let url = run.link { out[String(a[run.range].characters)] = url.absoluteString } }
    return out
}

@Suite struct HtmlTextTests {
    @Test func paragraphsBecomeBlankLine() {
        #expect(plain("<p>Letture per bambini da 18 a 36 mesi.</p> <p>ORARIO: dalle 10:00 alle 11:00.</p>")
            == "Letture per bambini da 18 a 36 mesi.\n\nORARIO: dalle 10:00 alle 11:00.")
    }

    @Test func brIsALineBreakAndTwoMakeABlankLine() {
        #expect(plain("<p>I concerti sono posticipati. <br><br>Le date:<br>17 novembre 2026 Napoli</p>")
            == "I concerti sono posticipati.\n\nLe date:\n17 novembre 2026 Napoli")
        #expect(plain("a<br/>b<BR>c") == "a\nb\nc")
    }

    @Test func manyBreaksStayAtOneBlankLine() {
        #expect(plain("a<br><br><br><br>b") == "a\n\nb")
        #expect(plain("<p>a</p><br><p>b</p>") == "a\n\nb")
    }

    @Test func leadingAndTrailingBlanksAreDropped() {
        #expect(plain("<p> </p><br><p>  ciao  </p><br>") == "ciao")
    }

    @Test func strongAndEmphasisAreKept() {
        let a = htmlToAttributed(#"<p>Con il palinsesto <strong>"Tesori Nascosti"</strong> e <em>UR-RA</em> <em><strong>tutto</strong></em>.</p>"#)
        #expect(String(a.characters) == #"Con il palinsesto "Tesori Nascosti" e UR-RA tutto."#)
        #expect(intents(a, of: "Tesori") == .stronglyEmphasized)
        #expect(intents(a, of: "UR-RA") == .emphasized)
        #expect(intents(a, of: "tutto") == [.emphasized, .stronglyEmphasized])
        #expect(intents(a, of: "palinsesto") == nil)
        #expect(intents(htmlToAttributed("<b>x</b>"), of: "x") == .stronglyEmphasized)
        #expect(intents(htmlToAttributed("<i>x</i>"), of: "x") == .emphasized)
    }

    @Test func headingsAreBoldOnTheirOwnBlock() {
        let a = htmlToAttributed("<h2>Programma</h2><p>Ore 10</p>")
        #expect(String(a.characters) == "Programma\n\nOre 10")
        #expect(intents(a, of: "Programma") == .stronglyEmphasized)
        #expect(intents(a, of: "Ore") == nil)
    }

    @Test func listItemsGetABullet() {
        #expect(plain("<ul><li>Pane</li><li>Vino <strong>rosso</strong></li></ul><p>Fine</p>") == "• Pane\n• Vino rosso\n\nFine")
    }

    @Test func entitiesAreDecodedOnce() {
        #expect(plain("<p>DJ SHOCCA &amp; FAM &egrave; qui, citt&agrave; di Pavia &nbsp;ok &#8217;x&#x27; &euro;5</p>")
            == "DJ SHOCCA & FAM è qui, città di Pavia ok ’x' €5")
        // &amp;lt; e' il testo "&lt;", non "<": una sola passata.
        #expect(plain("1 &amp;lt; 2 &lt;b&gt;") == "1 &lt; 2 <b>")
    }

    @Test func unknownOrBrokenEntitiesStayAsTyped() {
        #expect(plain("Tom &Jerry; &#xZZ; &#99999999999; AT&T") == "Tom &Jerry; &#xZZ; &#99999999999; AT&T")
    }

    @Test func unknownTagsAreDroppedAndTheirTextKept() {
        #expect(plain("<p>Ciao <span class=\"x\">mondo</span> <foo-bar data-x='1'>!</foo-bar></p>") == "Ciao mondo !")
    }

    @Test func scriptStyleAndImagesDisappear() {
        #expect(plain("<p>a</p><script>alert('x <b>')</script><style>p{color:red}</style><img src=\"http://x/y.png\" alt=\"zz\"><p>b</p>")
            == "a\n\nb")
        #expect(plain("a<!-- nascosto <b> -->b") == "ab")
        #expect(plain("<iframe src=\"https://x\">dentro</iframe>fuori") == "fuori")
    }

    @Test func plainTextWithoutTagsIsUntouched() {
        let text = "Prima riga\nSeconda riga  con due spazi\n\n5 < 7 e 9 > 3."
        #expect(plain(text) == text)
        #expect(plain("  solo spazi  ") == "solo spazi")
        #expect(plain("") == "")
        #expect(plain("Tom &amp; Jerry") == "Tom & Jerry")
    }

    @Test func lessThanThatIsNotATagStaysText() {
        #expect(plain("<p>5 < 7 e a<b</p>") == "5 < 7 e a<b")
    }

    @Test func httpLinksAreTappable() {
        let a = htmlToAttributed(#"<p>Info: <a href="https://example.org/a?b=1&amp;c=2" target="_blank">il sito</a>.</p>"#)
        #expect(String(a.characters) == "Info: il sito.")
        #expect(links(a) == ["il sito": "https://example.org/a?b=1&c=2"])
    }

    @Test func otherSchemesAreNotLinks() {
        let a = htmlToAttributed(#"<a href="javascript:alert(1)">uno</a> <a href="mailto:a@b.it">due</a> <a href="tel:123">tre</a> <a href="/relativo">quattro</a> <a>cinque</a>"#)
        #expect(String(a.characters) == "uno due tre quattro cinque")
        #expect(links(a).isEmpty)
    }

    @Test func bareUrlsInTextBecomeLinks() {
        let url = "https://eventi.comune.torino.it/calendario/star-trek-60-al-mufant/"
        let a = htmlToAttributed("\(url) In occasione dei sessant'anni")
        #expect(links(a) == [url: url])
    }

    @Test func veryLongUrlsAreKeptWhole() {
        let url = "https://example.org/" + String(repeating: "abcdefghij/", count: 60) + "fine"
        let text = plain("<p>Vedi \(url) subito</p>")
        #expect(text == "Vedi \(url) subito")
        #expect(links(htmlToAttributed(url)) == [url: url])
    }

    @Test func controlCharactersAreRemoved() {
        #expect(plain("a\u{0}b\u{7}c<p>d</p>") == "abc\n\nd")
    }

    @Test func unterminatedTagIsText() {
        #expect(plain("ciao <p class=\"x") == "ciao <p class=\"x")
    }
}
