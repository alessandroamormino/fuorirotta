import FuorirottaCore
import Observation
import SwiftUI

/// Cosa segue l'account (UAT7 B1). Una sola copia per l'app: la usano il dettaglio evento, "Cosa segui" e la Home.
/// Il server resta la fonte: la lista si rilegge a ogni apertura di "Cosa segui" (puo' essere cambiata dal sito).
@MainActor @Observable
final class FollowsModel {
    enum Outcome { case done, cap, failed }

    /// nil = non caricata (ospite, rete, o in arrivo).
    private(set) var items: [FollowItem]?
    private(set) var failed = false
    /// Cambia a ogni modifica riuscita: la Home ricarica "Per te".
    private(set) var revision = 0

    private let api: APIClient

    init(api: APIClient) { self.api = api }

    var placeCount: Int { items?.filter(\.isPlace).count ?? 0 }
    var capReached: Bool { placeCount >= ApiContract.placeCap }

    func load() async {
        failed = false
        do {
            items = try await api.follows().follows
        } catch {
            if items == nil { failed = true }
        }
    }

    /// All'uscita dall'account: dell'account non resta nulla in memoria.
    func reset() {
        items = nil
        failed = false
    }

    func isFollowing(_ item: FollowItem) -> Bool { items?.contains { $0.id == item.id } ?? false }

    /// Ottimistico, come lo store del sito: la voce cambia subito e torna com'era se il server rifiuta (solo lei: le
    /// altre modifiche nel frattempo restano).
    func set(_ item: FollowItem, on: Bool) async -> Outcome {
        if items == nil { await load() }  // la lista non era arrivata (rete): senza, non si sa cosa c'e' gia'
        guard items != nil else { return .failed }
        guard on != isFollowing(item) else { return .done }
        if on, item.isPlace, capReached { return .cap }
        apply(item, on: on)
        do {
            if on {
                // L'etichetta la decide il server (T-23-03): sostituisce quella costruita sul telefono.
                if let label = try await api.follow(kind: item.kind, key: item.key), let i = items?.firstIndex(where: { $0.id == item.id }) {
                    items?[i].label = label
                }
            } else {
                try await api.unfollow(kind: item.kind, key: item.key)
            }
            revision += 1
            return .done
        } catch {
            apply(item, on: !on)
            if case APIError.http(409, "cap") = error { return .cap }
            return .failed
        }
    }

    private func apply(_ item: FollowItem, on: Bool) {
        guard var list = items else { return }
        list.removeAll { $0.id == item.id }
        items = on ? sortFollows(list + [item]) : list
    }

    /// Il testo dell'avviso per un esito non riuscito; nil se e' andata.
    static func message(_ outcome: Outcome) -> String? {
        switch outcome {
        case .done: nil
        case .cap: String(localized: "Hai raggiunto il limite di 50 luoghi seguiti")
        case .failed: String(localized: "Non siamo riusciti a salvare. Riprova tra poco.")
        }
    }
}

/// Simbolo di un tipo di follow, uguale in "Cosa segui" e nel menu del dettaglio.
func followSymbol(_ item: FollowItem) -> String {
    switch item.kind {
    case "region": "map"
    case "province": "map"
    case "comune": "building.2"
    default: categoryVisual(item.key).symbol
    }
}

/// "Cosa segui" (FollowManager.tsx): luoghi e categorie. Vista senza NavigationStack: chi la usa la spinge nella sua
/// pila (oggi Impostazioni, con B6 il Profilo). Luoghi: ricerca di sistema in alto (/api/places/search), elimina a
/// scorrimento o con Modifica. Categorie: righe con la spunta.
struct FollowsView: View {
    @Environment(FollowsModel.self) private var follows
    @Environment(\.api) private var api

    @State private var query = ""
    @State private var results: [PlaceOption]?
    @State private var searchFailed = false
    @State private var message: String?

    private var searching: Bool { query.trimmingCharacters(in: .whitespaces).count >= 2 }

    var body: some View {
        List {
            if searching {
                searchSection
            } else if let items = follows.items {
                Section {
                    let places = items.filter(\.isPlace)
                    if places.isEmpty {
                        Text("Non segui ancora nessun luogo.").foregroundStyle(Color.mutedForeground)
                    }
                    ForEach(places) { item in
                        Label { Text(verbatim: item.label) } icon: { Image(systemName: followSymbol(item)) }
                            .foregroundStyle(Color.foreground)
                            .accessibilityAction(named: "Smetti di seguire") { change(item, on: false) }
                    }
                    .onDelete { offsets in
                        for i in offsets { change(places[i], on: false) }
                    }
                } header: {
                    Text("Luoghi")
                } footer: {
                    if follows.capReached {
                        Text("Hai raggiunto il limite di 50 luoghi seguiti")
                    } else {
                        Text("Cerca un comune, una provincia o una regione qui sopra per aggiungerlo.")
                    }
                }
                Section("Categorie") {
                    ForEach(ApiContract.categories, id: \.self) { name in categoryRow(name) }
                }
                if let message {
                    Section { Text(verbatim: message).foregroundStyle(Color.destructive) }
                }
            } else if follows.failed {
                ContentUnavailableView {
                    Label("Cosa segui non è disponibile", systemImage: "wifi.slash")
                } description: {
                    Text("Non riusciamo a caricare cosa segui. Riprova tra poco.")
                } actions: {
                    Button("Riprova") { Task { await follows.load() } }
                }
                .listRowBackground(Color.clear)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 88).listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Cosa segui")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Cerca comune, provincia o regione"))
        .toolbar { if follows.items?.contains(where: \.isPlace) == true { EditButton() } }
        .task { await follows.load() }
        .task(id: query) { await search() }
    }

    // MARK: ricerca dei luoghi

    @ViewBuilder private var searchSection: some View {
        Section {
            if follows.capReached {
                Text("Hai raggiunto il limite di 50 luoghi seguiti").foregroundStyle(Color.mutedForeground)
            } else if searchFailed {
                Text("Non riusciamo a cercare adesso. Riprova tra poco.").foregroundStyle(Color.mutedForeground)
            } else if let results {
                if results.isEmpty {
                    Text("Nessun luogo trovato per «\(query.trimmingCharacters(in: .whitespaces))».").foregroundStyle(Color.mutedForeground)
                }
                ForEach(results) { option in
                    let already = follows.isFollowing(option.item)
                    Button {
                        change(option.item, on: true)
                        query = ""
                    } label: {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(verbatim: option.label).foregroundStyle(Color.foreground)
                            if already {
                                Label("Già seguito", systemImage: "checkmark").font(.label).foregroundStyle(Color.mutedForeground)
                            } else {
                                Text(verbatim: option.sublabel).font(.label).foregroundStyle(Color.mutedForeground)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(already)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    /// Come PlacePicker.tsx: 200 ms di pausa dopo l'ultima lettera, poi una richiesta (la precedente si annulla con il task).
    private func search() async {
        results = nil
        searchFailed = false
        guard searching, let api else { return }
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled else { return }
        do {
            let found = try await api.searchPlaces(q: query.trimmingCharacters(in: .whitespaces))
            guard !Task.isCancelled else { return }
            results = found
        } catch {
            guard !Task.isCancelled else { return }
            searchFailed = true
        }
    }

    // MARK: categorie

    private func categoryRow(_ name: String) -> some View {
        let item = FollowItem(kind: "category", key: name, label: name)
        let on = follows.isFollowing(item)
        return Button {
            change(item, on: !on)
        } label: {
            HStack(spacing: Spacing.md) {
                Circle().fill(categoryVisual(name).color).frame(width: 10, height: 10).accessibilityHidden(true)
                Text(verbatim: categoryLabel(name)).foregroundStyle(Color.foreground)
                Spacer()
                if on { Image(systemName: "checkmark").foregroundStyle(Color.accentToken).accessibilityHidden(true) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func change(_ item: FollowItem, on: Bool) {
        message = nil
        Task { message = FollowsModel.message(await follows.set(item, on: on)) }
    }
}

/// "Segui" nel dettaglio evento: comune, provincia e categoria in un menu di sistema con le spunte. Da ospite apre
/// l'accesso (come FollowButton.tsx); l'intento non si ricorda.
// ponytail: il sito ricorda cosa l'ospite voleva seguire e lo segue dopo l'accesso (intent in sessionStorage); qui no.
struct EventFollowRow: View {
    let event: Event

    @Environment(FollowsModel.self) private var follows
    @Environment(Session.self) private var session
    @Environment(SavesModel.self) private var saves

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    var body: some View {
        let targets = followTargets(for: event)
        if !targets.isEmpty {
            if signedIn {
                Menu {
                    ForEach(targets) { target in
                        Toggle(isOn: Binding(get: { follows.isFollowing(target) }, set: { on in toggle(target, on: on) })) {
                            Label { Text(verbatim: title(target)) } icon: { Image(systemName: followSymbol(target)) }
                        }
                    }
                } label: {
                    label(targets)
                }
                .task { if follows.items == nil { await follows.load() } }
            } else {
                Button { session.presentSignIn = true } label: { label(targets) }
            }
        }
    }

    private func label(_ targets: [FollowItem]) -> some View {
        let followed = targets.filter { follows.isFollowing($0) }.map(title)
        return HStack(spacing: Spacing.md) {
            Image(systemName: followed.isEmpty ? "plus.circle" : "checkmark.circle").frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Segui").font(.body)
                if !followed.isEmpty {
                    Text(verbatim: followed.joined(separator: ", ")).font(.label).foregroundStyle(Color.mutedForeground)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Color.accentToken)
        .contentShape(Rectangle())
    }

    /// Nel menu: il nome del comune, "Provincia di X" e la categoria nella lingua dell'app.
    private func title(_ item: FollowItem) -> String {
        switch item.kind {
        case "comune": event.comune?.name ?? item.label
        case "province": event.comune?.provinceName.map { String(localized: "Provincia di \($0)") } ?? item.label
        default: categoryLabel(item.key)
        }
    }

    private func toggle(_ item: FollowItem, on: Bool) {
        Task { if let text = FollowsModel.message(await follows.set(item, on: on)) { saves.show(text) } }
    }
}
