import FuorirottaCore
import SwiftUI

/// Una pagina del benvenuto: illustrazione SF Symbol grande, titolo, una riga di testo. La usa anche la scelta degli interessi.
struct WelcomePage: View {
    let symbol: String
    let title: LocalizedStringKey
    let text: LocalizedStringKey
    /// Sopra una lista (interessi): illustrazione e titolo piu' piccoli, la lista resta in vista anche con la tastiera.
    var compact = false

    var body: some View {
        VStack(spacing: compact ? Spacing.md : Spacing.lg) {
            // foreground, non accento: l'accento e' riservato (UI-SPEC, Color), come la spiegazione della posizione.
            Image(systemName: symbol)
                .font(compact ? .symbolHero : .symbolWelcome)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Color.foreground)
                .accessibilityHidden(true)
            Text(title)
                .font(compact ? .heading : .display)
                .foregroundStyle(Color.foreground)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(text)
                .font(.body)
                .foregroundStyle(Color.foregroundSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, Spacing.lg)
        .frame(maxWidth: .infinity)
    }
}

/// Il tutorial del primo avvio (UAT7 B5): una volta per installazione, anche da ospite. Pagine di sistema (TabView
/// paginata) con l'indicatore, "Avanti" / "Inizia" in basso e "Salta" sempre in alto. Nessuna richiesta di permessi:
/// la posizione si spiega dopo, nella sua schermata.
struct WelcomeView: View {
    static let seenKey = "fr.welcomeSeen"

    @AppStorage(seenKey) private var seen = false
    @State private var page = 0

    private struct Page {
        let symbol: String
        let title: LocalizedStringKey
        let text: LocalizedStringKey
    }

    private let pages = [
        Page(symbol: "mappin.and.ellipse", title: "Eventi vicino a te",
             text: "Sagre, concerti, mercati e mostre intorno a te: in Home trovi cosa c'è questo weekend e vicino a te."),
        Page(symbol: "map", title: "La mappa",
             text: "Guarda cosa c'è in giro sulla mappa. Tocca un punto per i dettagli e le indicazioni."),
        Page(symbol: "heart", title: "Salva col cuore",
             text: "Tocca il cuore su un evento e lo ritrovi in Salvati, giorno per giorno. Con l'account li hai su ogni dispositivo."),
        Page(symbol: "sparkles", title: "Segui ciò che ti piace",
             text: "Segui categorie e luoghi: «Per te» in Home raccoglie i loro eventi e le notifiche ti avvisano delle novità."),
    ]

    var body: some View {
        NavigationStack {
            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { i in
                    WelcomePage(symbol: pages[i].symbol, title: pages[i].title, text: pages[i].text)
                        .padding(.bottom, Spacing.xxl)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            .background(Color.background)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Salta") { seen = true }
                }
            }
            .safeAreaBar(edge: .bottom) {
                let last = page == pages.count - 1
                Button {
                    if last { seen = true } else { withAnimation(Motion.spring) { page += 1 } }
                } label: {
                    Text(last ? "Inizia" : "Avanti").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(Spacing.lg)
            }
        }
    }
}

/// La scelta degli interessi al primo accesso (OnboardingDialog.tsx), una volta per account: se l'account l'ha gia'
/// vista (qui o sul sito, `onboarded` di /api/v1/me/follows) non si ripropone. Niente preselezionato. "Fatto" manda
/// luoghi e categorie insieme al segno "vista" in una richiesta sola; "Salta" manda solo il segno.
struct InterestsView: View {
    @Environment(FollowsModel.self) private var follows
    @Environment(SavesModel.self) private var saves
    @Environment(\.api) private var api

    @State private var search = PlaceSearch()
    @State private var picks: [FollowItem] = []
    @State private var categories: Set<String> = []
    @State private var saving = false
    @State private var error: String?
    @FocusState private var typing: Bool

    /// Chi segue gia' un luogo (dal dettaglio, prima di questa schermata) lo vede "Già seguito" e conta per il tetto.
    private func followed(_ item: FollowItem) -> Bool { follows.isFollowing(item) || picks.contains { $0.id == item.id } }
    private var capReached: Bool { follows.placeCount + picks.count >= ApiContract.placeCap }

    var body: some View {
        NavigationStack {
            List {
                // Mentre si cerca l'intestazione si toglie: con la tastiera aperta i risultati restano in vista.
                if !search.active {
                    Section {
                        WelcomePage(symbol: "sparkles", title: "Cosa vuoi seguire?",
                                text: "Scegli i posti e le categorie che ti interessano: li ritrovi in «Per te» nella Home. Puoi cambiare tutto quando vuoi da «Cosa segui».", compact: true)
                    }
                    .listRowBackground(Color.clear)
                }
                Section("Luoghi") {
                    Label {
                        TextField("Cerca comune, provincia o regione", text: Bindable(search).query)
                            .autocorrectionDisabled()
                            .submitLabel(.search)
                            .focused($typing)
                    } icon: {
                        Image(systemName: "magnifyingglass").foregroundStyle(Color.mutedForeground)
                    }
                    if search.active {
                        PlaceSearchRows(search: search, capReached: capReached, isFollowed: followed) {
                            picks.append($0)
                            typing = false
                        }
                    } else {
                        ForEach(picks) { item in
                            Label { Text(verbatim: item.label) } icon: { Image(systemName: followSymbol(item)) }
                                .foregroundStyle(Color.foreground)
                                .accessibilityAction(named: "Togli") { picks.removeAll { $0.id == item.id } }
                        }
                        .onDelete { picks.remove(atOffsets: $0) }
                    }
                }
                Section("Categorie") {
                    ForEach(ApiContract.categories, id: \.self) { name in
                        CategoryCheckRow(name: name, on: categories.contains(name)) {
                            if categories.remove(name) == nil { categories.insert(name) }
                        }
                    }
                }
                if let error {
                    Section { Label { Text(verbatim: error) } icon: { Image(systemName: "exclamationmark.circle") }.foregroundStyle(Color.destructive) }
                }
            }
            .disabled(saving)
            .scrollDismissesKeyboard(.interactively)
            .task(id: search.query) { await search.run(api) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Salta") { follows.skipOnboarding() }.disabled(saving)
                }
            }
            .safeAreaBar(edge: .bottom) {
                // Con la tastiera aperta "Fatto" si nasconde: coprirebbe i risultati della ricerca.
                if !typing {
                    Button {
                        Task { await save() }
                    } label: {
                        ZStack {
                            Text("Fatto").opacity(saving ? 0 : 1)
                            if saving { ProgressView() }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(saving)
                    .padding(Spacing.lg)
                }
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        let chosen = picks.count + categories.count
        // L'ordine delle categorie e' quello della tassonomia, come le spunte sullo schermo.
        switch await follows.finishOnboarding(places: picks, categories: ApiContract.categories.filter(categories.contains)) {
        case .done:
            if chosen > 0 { saves.show(String(localized: "Preferenze salvate")) }
        case .cap:
            error = String(localized: "Hai raggiunto il limite di 50 luoghi seguiti")
        case .failed:
            error = String(localized: "Non siamo riusciti a salvare le tue scelte. Riprova.")
        }
        saving = false
    }
}
