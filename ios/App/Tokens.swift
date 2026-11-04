import SwiftUI

// UNICO punto di scambio del brand provvisorio (D-05). Colori: Asset Catalog (chiaro e scuro, nome = token).
// Il designer sostituisce Assets.xcassets e questo file; le schermate non si toccano.
// check:ios-contract (S4) fallisce se un'altra schermata scrive un esadecimale o una dimensione di font fissa.
// Nessun colorScheme forzato (D-07): l'app segue l'aspetto di sistema.

extension Color {
    static let accentToken = Color("AccentColor")
    static let background = Color("background")
    static let surface = Color("surface")
    static let surfaceStrong = Color("surfaceStrong")
    static let foreground = Color("foreground")
    static let foregroundSecondary = Color("foregroundSecondary")
    static let mutedForeground = Color("mutedForeground")
    static let destructive = Color("destructive")
    static let success = Color("success")
    /// Il cuore dei salvati, pieno: rosso di sistema (come il cuore del sito), si adatta da solo a chiaro e scuro.
    static let heart = Color.red
    static let scrim = Color("scrim")
    // Pulsante Google: colori imposti dal marchio (eccezione, come sul web), uguali in chiaro e scuro.
    static let googleFill = Color("googleFill")
    static let googleBorder = Color("googleBorder")
    static let googleText = Color("googleText")
}

extension Color {
    /// Fondi dell'avatar senza foto (REF Omniphile "Community"): i colori delle categorie, scelti dal nome in modo stabile.
    static let avatarPalette: [Color] = ["categorySagre", "categoryMusica", "categoryArte", "categoryFiere", "categorySport", "categoryFood"].map { Color($0) }
}

enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 48
    static let xxxl: CGFloat = 64
}

enum Radius {
    static let cell: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let card: CGFloat = 24
    // Locandine e schede larghe delle file di Home (REF Omniphile: angoli circa 16).
    static let media: CGFloat = 16
    // Card "Questo weekend" in Home: un po' piu' stondata delle altre schede (feedback F3).
    static let hero: CGFloat = 32
}

// Solo stili di testo di sistema: scalano con Dynamic Type. Il corpo usa `.body` com'e'.
extension Font {
    static let display = Font.largeTitle.weight(.semibold)
    static let heading = Font.title2.weight(.semibold)
    static let label = Font.footnote
    // Simboli illustrativi (schermata della posizione 64, carta dell'invito 28): non sono testo, restano fissi.
    static let symbolHero = Font.system(size: 64, weight: .regular)
    static let symbolCard = Font.system(size: 28, weight: .regular)
    // Le illustrazioni del benvenuto (UAT7 B5): una per pagina, a tutto schermo.
    static let symbolWelcome = Font.system(size: 96, weight: .light)
}

struct CategoryVisual {
    let color: Color
    let symbol: String
}

private let visuals: [String: CategoryVisual] = [
    "Sagre e feste": CategoryVisual(color: Color("categorySagre"), symbol: "party.popper"),
    "Musica e spettacolo": CategoryVisual(color: Color("categoryMusica"), symbol: "music.note"),
    "Arte e cultura": CategoryVisual(color: Color("categoryArte"), symbol: "paintpalette"),
    "Fiere e mercati": CategoryVisual(color: Color("categoryFiere"), symbol: "storefront"),
    "Sport e outdoor": CategoryVisual(color: Color("categorySport"), symbol: "figure.run"),
    "Food & Wine": CategoryVisual(color: Color("categoryFood"), symbol: "wineglass"),
]

/// Il nome di una categoria nella lingua dell'app. Il nome italiano del contratto resta l'identita' (filtri, API, colori):
/// qui si traduce solo per mostrarlo. Un nome fuori dal catalogo torna com'e'.
func categoryLabel(_ name: String) -> String { Bundle.main.localizedString(forKey: name, value: name, table: nil) }

/// Come sul web: qualunque nome sconosciuto o assente cade su Altro (alias di mutedForeground).
func categoryVisual(_ name: String?) -> CategoryVisual {
    name.flatMap { visuals[$0] } ?? CategoryVisual(color: .mutedForeground, symbol: "tag")
}

enum Motion {
    static let spring = Animation.spring(duration: 0.35, bounce: 0.15)
    static let snappy = Animation.snappy
}
