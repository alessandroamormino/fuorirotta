import FuorirottaCore
import SwiftUI

// UAT7 B2: dal menu della barra di Salvati (solo con l'account), due fogli di sistema con gli stessi testi e le stesse
// conferme del sito (ShareListDialog.tsx, CalendarFeedDialog.tsx). Rigenerare invalida il vecchio link e lo si dice.

/// Il tasto "Copia link": per due secondi dice "Link copiato".
private struct CopyLinkButton: View {
    let url: URL
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = url.absoluteString
            copied = true
        } label: {
            Label(copied ? "Link copiato" : "Copia link", systemImage: copied ? "checkmark" : "doc.on.doc")
        }
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }
}

/// Testo d'errore o d'avviso in fondo a una sezione.
private func notice(_ text: String?, error: Bool = false) -> some View {
    Group {
        if let text { Text(verbatim: text).foregroundStyle(error ? Color.destructive : Color.foregroundSecondary) }
    }
}

// MARK: condividi la lista

struct ShareListSheet: View {
    @Environment(\.api) private var api
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Equatable { case loading, failed, ready(ShareState) }
    private enum Confirm { case off, regen }

    @State private var phase = Phase.loading
    @State private var busy = false
    @State private var confirm: Confirm?
    @State private var message: String?
    @State private var failure: String?

    private var ownerName: String {
        if case .signedIn(let user) = session.state { return user.name }
        return ""
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Manda la tua lista di eventi salvati a chi vuoi con un link: si apre senza account.")
                        .foregroundStyle(Color.foregroundSecondary)
                }
                switch phase {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity)
                case .failed:
                    Section {
                        Text("Non riusciamo a caricare lo stato del link. Riprova tra poco.")
                        Button("Riprova") { Task { await load() } }
                    }
                case .ready(let state):
                    if let link = state.link, let base = api?.baseURL, let url = shareURL(base: base, path: link.path) {
                        linkSections(state: state, link: link, url: url)
                    } else {
                        createSection(upcoming: state.upcoming)
                    }
                }
            }
            .navigationTitle("Condividi la lista")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() }.disabled(busy) }
            }
            .confirmationDialog(confirm == .off ? "Disattivare il link?" : "Generare un nuovo link?", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
                if confirm == .off {
                    Button("Sì, disattiva", role: .destructive) { Task { await deactivate() } }
                } else {
                    Button("Sì, genera", role: .destructive) { Task { await rotate() } }
                }
                Button("Annulla", role: .cancel) {}
            } message: {
                Text(confirm == .off
                    ? "Chi ha il link attuale non potrà più aprirlo. Potrai crearne uno nuovo quando vuoi."
                    : "Chi ha il link attuale non potrà più aprirlo. Il nuovo link funziona subito.")
            }
            .task { await load() }
        }
        // Creare, sostituire o disattivare non si abbandona a meta' (come il sito).
        .interactiveDismissDisabled(busy)
    }

    private func createSection(upcoming n: Int) -> some View {
        Section {
            Text(n == 0
                ? "Al momento non hai eventi in arrivo tra i salvati: chi apre il link vedrà quelli che salverai da ora in poi."
                : n == 1 ? "Chiunque abbia il link vedrà il tuo evento in arrivo." : "Chiunque abbia il link vedrà i tuoi \(n) eventi in arrivo.")
            Text("La lista si aggiorna da sola: se aggiungi o togli un evento, chi ha il link lo vede subito. Non vede la tua email né altri dati del tuo account. La tua lista resta privata finché non crei un link.")
                .font(.label)
                .foregroundStyle(Color.foregroundSecondary)
            Button {
                Task { await create() }
            } label: {
                HStack {
                    Text("Crea link")
                    if busy { Spacer(); ProgressView() }
                }
            }
            .disabled(busy)
            notice(failure, error: true)
            notice(message)
        }
    }

    @ViewBuilder private func linkSections(state: ShareState, link: ShareLinkInfo, url: URL) -> some View {
        let n = state.upcoming
        Section {
            Text(verbatim: url.absoluteString).textSelection(.enabled).foregroundStyle(Color.foreground)
            // Il foglio di sistema porta solo il titolo fisso e il link: mai il nome, mai un conteggio (come il sito).
            ShareLink(item: url, subject: Text("Eventi salvati su Fuorirotta"), message: Text("Guarda gli eventi che ho salvato su Fuorirotta.")) {
                Label("Condividi", systemImage: "square.and.arrow.up")
            }
            CopyLinkButton(url: url)
        } header: {
            Text("Il link")
        } footer: {
            Text(n == 0
                ? "Chiunque abbia questo link vede la tua lista, che al momento non ha eventi in arrivo. Non vede la tua email né altri dati del tuo account."
                : n == 1
                    ? "Chiunque abbia questo link vede il tuo evento in arrivo, anche senza account. Non vede la tua email né altri dati del tuo account."
                    : "Chiunque abbia questo link vede i tuoi \(n) eventi in arrivo, anche senza account. Non vede la tua email né altri dati del tuo account.")
        }
        Section {
            Toggle("Mostra il mio nome", isOn: Binding(get: { link.showName }, set: { on in Task { await setShowName(on) } }))
                .disabled(busy)
        } footer: {
            if link.showName, !ownerName.isEmpty {
                Text("Chi apre il link vede il titolo «I salvati di \(ownerName)».")
            } else {
                Text("Chi apre il link vede il titolo «Eventi salvati».")
            }
        }
        Section {
            Button("Genera nuovo link") { confirm = .regen }.disabled(busy)
            Button("Disattiva link", role: .destructive) { confirm = .off }.disabled(busy)
            if busy { ProgressView().frame(maxWidth: .infinity) }
            notice(failure, error: true)
            notice(message)
        }
    }

    // MARK: rete

    private var ready: ShareState? {
        if case .ready(let state) = phase { return state }
        return nil
    }

    private func load() async {
        guard let api else { return }
        if ready == nil { phase = .loading }
        do { phase = .ready(try await api.shareState()) } catch { if ready == nil { phase = .failed } }
    }

    /// Un'altra sessione ha gia' tolto il link: si riparte dallo stato vero.
    private func inactive() async {
        message = String(localized: "Il link non era più attivo.")
        await load()
    }

    private func run(_ work: (APIClient) async throws -> Void, failed text: String) async {
        guard let api, !busy else { return }
        busy = true
        failure = nil
        message = nil
        defer { busy = false }
        do {
            try await work(api)
        } catch APIError.http(404, _) {
            await inactive()
        } catch {
            failure = text
        }
    }

    private func create() async {
        await run({ api in
            let link = try await api.createShareLink()
            if let state = ready { phase = .ready(ShareState(link: link, upcoming: state.upcoming)) }
        }, failed: String(localized: "Non riusciamo a creare il link. Riprova tra poco."))
    }

    private func rotate() async {
        await run({ api in
            let link = try await api.rotateShareLink()
            if let state = ready { phase = .ready(ShareState(link: link, upcoming: state.upcoming)) }
            message = String(localized: "Nuovo link creato. Quello vecchio non funziona più.")
        }, failed: String(localized: "Non siamo riusciti a generare un nuovo link. Riprova tra poco."))
    }

    private func deactivate() async {
        await run({ api in
            try await api.deleteShareLink()
            // La riga sparisce con il link: il prossimo parte con il nome spento (D-11).
            if let state = ready { phase = .ready(ShareState(link: nil, upcoming: state.upcoming)) }
            message = String(localized: "Link disattivato. Chi lo aveva non può più aprirlo.")
        }, failed: String(localized: "Non siamo riusciti a disattivare il link. Riprova tra poco."))
    }

    /// Il nome si applica subito allo stesso link (D-04): ottimista, annullato se il server rifiuta.
    private func setShowName(_ on: Bool) async {
        guard var state = ready, let link = state.link else { return }
        state.link = ShareLinkInfo(path: link.path, showName: on)
        phase = .ready(state)
        await run({ api in
            let saved = try await api.setShareShowsName(on)
            if var now = ready, let current = now.link {
                now.link = ShareLinkInfo(path: current.path, showName: saved)
                phase = .ready(now)
            }
        }, failed: String(localized: "Non siamo riusciti a salvare la scelta. Riprova."))
        if failure != nil, var now = ready, let current = now.link {
            now.link = ShareLinkInfo(path: current.path, showName: link.showName)
            phase = .ready(now)
        }
    }
}

// MARK: iscriviti nel calendario

struct CalendarFeedSheet: View {
    @Environment(\.api) private var api
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    @State private var path: String?
    @State private var failed = false
    @State private var rotating = false
    @State private var confirming = false
    @State private var message: String?
    /// Cosa rifare con "Riprova": una rigenerazione fallita non deve ripiegare sul link vecchio.
    @State private var lastRotate = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("I tuoi salvati compaiono nel calendario e si aggiornano da soli. Ogni evento ha un promemoria alle 18:00 del giorno prima, se il tuo calendario lo supporta.")
                        .foregroundStyle(Color.foregroundSecondary)
                }
                if failed {
                    Section {
                        Text("Non riusciamo a creare il link. Riprova tra poco.")
                        Button("Riprova") { Task { await run(rotate: lastRotate) } }
                    }
                } else if let path, let base = api?.baseURL, let webcal = webcalURL(base: base, path: path), let https = feedURL(base: base, path: path) {
                    Section {
                        // iOS apre il webcal:// in Calendario e propone l'iscrizione.
                        Button { openURL(webcal) } label: { Label("Iscriviti nel Calendario", systemImage: "calendar.badge.plus") }
                    } footer: {
                        Text("Chiunque abbia questo link può vedere i tuoi eventi salvati. Non condividerlo.")
                    }
                    Section {
                        Text(verbatim: https.absoluteString).textSelection(.enabled).foregroundStyle(Color.foreground)
                        CopyLinkButton(url: https)
                    } header: {
                        Text("Google Calendar")
                    } footer: {
                        Text("Copia il link. In Google Calendar, accanto ad Altri calendari, tocca + e scegli Da URL. Incolla il link e conferma.")
                    }
                    Section {
                        Button("Rigenera link", role: .destructive) { confirming = true }.disabled(rotating)
                        if rotating { ProgressView().frame(maxWidth: .infinity) }
                        notice(message)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Iscriviti nel Calendario")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() }.disabled(rotating) }
            }
            .confirmationDialog("Rigenerare il link?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Sì, rigenera", role: .destructive) { Task { await run(rotate: true) } }
                Button("Annulla", role: .cancel) {}
            } message: {
                Text("Il link attuale smetterà di funzionare e dovrai iscriverti di nuovo da ogni calendario.")
            }
            .task { await run(rotate: false) }
        }
        .interactiveDismissDisabled(rotating)
    }

    /// Il feed si crea alla prima richiesta ed e' lo stesso a ogni apertura (get-or-create), finche' non si rigenera.
    private func run(rotate: Bool) async {
        guard let api else { return }
        lastRotate = rotate
        failed = false
        message = nil
        if rotate { rotating = true }
        defer { rotating = false }
        do {
            path = rotate ? try await api.rotateCalendarFeed() : try await api.calendarFeed()
            if rotate { message = String(localized: "Nuovo link creato. Quello vecchio non funziona più.") }
        } catch {
            failed = true
        }
    }
}
