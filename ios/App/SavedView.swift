import FuorirottaCore
import SwiftUI

struct SavedView: View {
    @Environment(SavesModel.self) private var saves
    @Environment(Session.self) private var session

    private enum Filter: String, CaseIterable {
        case upcoming = "Prossimi"
        case past = "Passati"
    }

    @State private var filter = Filter.upcoming

    private struct Group: Identifiable {
        let title: String?
        let rows: [SavedRow]
        var id: String { title ?? "-" }
    }

    var body: some View {
        let today = romeToday()
        let shown = rows(for: filter, today: today)
        EventStack {
            List {
                if saves.offline {
                    Label("Sei offline. Mostriamo gli ultimi dati salvati.", systemImage: "wifi.slash")
                        .font(.label)
                        .foregroundStyle(Color.foregroundSecondary)
                        .banner()
                }
                if saves.guestCount != nil, !saves.rows.isEmpty {
                    guestBanner
                }
                if saves.loading && saves.rows.isEmpty {
                    ForEach(0..<4, id: \.self) { _ in skeletonRow }
                } else {
                    ForEach(groups(shown)) { group in
                        Section {
                            ForEach(group.rows) { row in
                                SavedRowView(row: row)
                                    .listRowSeparator(.hidden)
                                    .swipeActions(edge: .trailing) {
                                        Button("Rimuovi", role: .destructive) { remove(row) }
                                    }
                                    .accessibilityAction(named: "Rimuovi") { remove(row) }
                            }
                        } header: {
                            if let title = group.title {
                                Text(verbatim: title).font(.heading).foregroundStyle(Color.foreground).textCase(nil)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .overlay { if !(saves.loading && saves.rows.isEmpty) && shown.isEmpty { emptyState } }
            .navigationTitle("Salvati")
            .safeAreaInset(edge: .top, spacing: 0) { chips }
            .task { await saves.reload() }
            .refreshable { await saves.reload() }
            .sensoryFeedback(.selection, trigger: filter)
        }
    }

    // MARK: pezzi

    private func remove(_ row: SavedRow) {
        Task { await saves.remove(row, message: "Rimosso dai salvati") }
    }

    private var chips: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(Filter.allCases, id: \.self) { f in
                let selected = f == filter
                Button(f.rawValue) { filter = f }
                    .font(.label.weight(.semibold))
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .foregroundStyle(selected ? Color.white : Color.foreground)
                    .background(selected ? Color.accentToken : Color.surface, in: Capsule())
                    .accessibilityAddTraits(selected ? .isSelected : [])
            }
            Spacer()
            if let n = saves.guestCount, n >= 90 {
                Text(verbatim: "\(n) di 100").font(.label).foregroundStyle(Color.mutedForeground)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(.bar)
    }

    private var guestBanner: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Sono salvati solo su questo iPhone.").font(.label).foregroundStyle(Color.foregroundSecondary)
            Button("Accedi per sincronizzarli") { session.presentSignIn = true }
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.accentToken)
        }
        .banner()
    }

    private var skeletonRow: some View {
        SavedRowView(row: SavedRow(
            entryID: 0, eventID: nil,
            snap: Snap(title: "Titolo dell'evento salvato", dateStart: "2026-01-01T00:00:00.000Z", dateEnd: nil, place: "Luogo", category: "Altro", source: "", sourceId: "", sourceUrl: nil),
            gone: false, prefix: "sk"))
            .redacted(reason: .placeholder)
            .listRowSeparator(.hidden)
            .accessibilityHidden(true)
    }

    @ViewBuilder private var emptyState: some View {
        if saves.loadFailed {
            ContentUnavailableView {
                Label("Salvati non disponibili", systemImage: "wifi.slash")
            } description: {
                Text("Non riusciamo a caricare i tuoi salvati. Controlla la connessione e riprova.")
            } actions: {
                Button("Riprova") { Task { await saves.reload() } }
            }
        } else if filter == .upcoming {
            ContentUnavailableView {
                Label("Nessun evento salvato", systemImage: "bookmark")
            } description: {
                Text("Tocca il segnalibro su un evento per ritrovarlo qui.")
            } actions: {
                // Ospite senza salvati: invito ad accedere, mai un blocco (lacuna del video, vedi OMNIPHILE-VIDEO).
                if saves.guestCount != nil {
                    Button("Accedi per sincronizzarli") { session.presentSignIn = true }
                }
            }
        } else {
            ContentUnavailableView {
                Label("Nessun evento passato", systemImage: "clock.arrow.circlepath")
            } description: {
                Text("Gli eventi salvati che sono già finiti compariranno qui.")
            }
        }
    }

    // MARK: ordine e gruppi

    /// Prossimi per giorno di inizio crescente, Passati dal piu' recente; le righe senza data in fondo.
    private func rows(for filter: Filter, today: String) -> [SavedRow] {
        let wanted = filter == .past
        let picked = saves.rows.filter { isPastEvent(dateStart: $0.dateStart, dateEnd: $0.dateEnd, today: today) == wanted }
        func key(_ r: SavedRow) -> String { r.days?.startDay ?? "" }
        return picked.sorted { a, b in
            if key(a).isEmpty != key(b).isEmpty { return !key(a).isEmpty }
            if key(a) != key(b) { return wanted ? key(a) > key(b) : key(a) < key(b) }
            return a.title < b.title
        }
    }

    /// Oltre 8 righe, intestazioni di mese (Heading); altrimenti un solo gruppo senza titolo.
    private func groups(_ rows: [SavedRow]) -> [Group] {
        guard rows.count > 8 else { return rows.isEmpty ? [] : [Group(title: nil, rows: rows)] }
        var out: [Group] = []
        for row in rows {
            let title = row.days.flatMap { monthTitle(day: $0.startDay) }
            if let last = out.last, last.title == title {
                out[out.count - 1] = Group(title: title, rows: last.rows + [row])
            } else {
                out.append(Group(title: title, rows: [row]))
            }
        }
        return out
    }
}

private extension View {
    /// Riga-avviso in cima alla lista: superficie, raggio card, senza separatori.
    func banner() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.card))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

struct SavedRowView: View {
    let row: SavedRow

    var body: some View {
        // Una riga il cui evento non esiste piu' non si apre.
        if !row.gone, let id = row.eventID {
            EventLink(event: event(id), slot: "saved") { content }
        } else {
            content
        }
    }

    /// Dall'istantanea: basta per aprire il dettaglio subito, il resto lo carica `event(id:)`.
    private func event(_ id: Int) -> Event {
        Event(id: id, title: row.title, dateStart: row.dateStart, dateEnd: row.dateEnd, locationName: row.place, category: row.category)
    }

    private var content: some View {
        let visual = categoryVisual(row.category)
        return HStack(spacing: Spacing.md) {
            // Lo snapshot del server non ha l'immagine (per scelta): le righe usano il segnaposto di categoria.
            RemoteImage(url: nil, category: row.category, size: CGSize(width: 72, height: 72))
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: row.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.foreground)
                    .lineLimit(2)
                if !row.meta.isEmpty {
                    Text(verbatim: row.meta)
                        .font(.label)
                        .foregroundStyle(Color.foregroundSecondary)
                        .lineLimit(1)
                }
                if row.gone {
                    Text("Evento non più disponibile").font(.label).foregroundStyle(Color.mutedForeground)
                } else {
                    HStack(spacing: Spacing.xs) {
                        Circle().fill(visual.color).frame(width: 8, height: 8)
                        Text(verbatim: row.category).font(.label).foregroundStyle(Color.mutedForeground)
                    }
                    .accessibilityHidden(true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Avviso di sistema in basso: 4 secondi, poi sparisce. Con "Annulla" il tocco esegue l'azione e lo chiude.
struct ToastBanner: View {
    let toast: Toast
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(verbatim: toast.message)
                .font(.label)
                .foregroundStyle(Color.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let title = toast.actionTitle, let action = toast.action {
                Button(title) {
                    action()
                    dismiss()
                }
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.accentToken)
            }
        }
        .padding(Spacing.md)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Radius.md))
        .task(id: toast.id) {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { dismiss() }
        }
        .accessibilityElement(children: .combine)
    }
}
