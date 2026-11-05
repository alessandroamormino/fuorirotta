import FuorirottaCore
import SwiftUI

struct SavedView: View {
    @Environment(SavesModel.self) private var saves
    @Environment(Session.self) private var session
    @Environment(VisitedModel.self) private var visited

    private enum Filter: CaseIterable {
        case upcoming, past, visited

        var title: LocalizedStringKey {
            switch self {
            case .upcoming: "Prossimi"
            case .past: "Passati"
            case .visited: "Visitati"
            }
        }
    }

    @State private var filter = Filter.upcoming
    @State private var sheet: SavedSheet?

    /// B2: i due fogli del menu della barra.
    private enum SavedSheet: Identifiable {
        case share, calendar
        var id: Self { self }
    }

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    /// Una riga della lista: la timeline e' piatta (una riga per elemento) cosi' lo scorrimento per Rimuovi resta di List.
    private enum Item: Identifiable {
        case month(String)
        case day(SavedDay<SavedRow>)
        case event(SavedRow, last: Bool)

        var id: String {
            switch self {
            case .month(let title): "m-\(title)"
            case .day(let d): d.id
            case .event(let row, _): row.id
            }
        }
    }

    // Piastrina del giorno e colonna della linea: misure della timeline.
    private static let tile = CGSize(width: 52, height: 56)
    private static let lineWidth: CGFloat = 2

    var body: some View {
        let today = romeToday()
        let days: [SavedDay<SavedRow>] = filter == .visited
            ? visitedTimeline(visited.rows.compactMap { r in visited.visitDays[r.id].map { (item: r, visitDay: $0) } }, locale: .app)
            : savedTimeline(saves.rows, past: filter == .past, today: today, locale: .app)
        // Salvati ha scheletri, avviso offline e invito per l'ospite; Visitati no (viene dal telefono o da una lista gia' caricata).
        let showSkeleton = filter != .visited && saves.loading && saves.rows.isEmpty
        EventStack {
            List {
                // UAT 6: riepilogo e chip sono contenuto, scorrono via con la lista (niente fascia fissa con fondo).
                header(summary(days, today: today))
                if filter != .visited, saves.offline {
                    Label("Sei offline. Mostriamo gli ultimi dati salvati.", systemImage: "wifi.slash")
                        .font(.label)
                        .foregroundStyle(Color.foregroundSecondary)
                        .banner()
                }
                if filter != .visited, saves.guestCount != nil, !saves.rows.isEmpty {
                    guestBanner
                }
                if showSkeleton {
                    ForEach(0..<4, id: \.self) { _ in skeletonRow }
                } else {
                    ForEach(items(days)) { item in
                        switch item {
                        case .month(let title):
                            monthRow(title)
                        case .day(let day):
                            dayRow(day)
                        case .event(let row, let last):
                            timelineRow(last: last) {
                                HStack(spacing: Spacing.xs) {
                                    SavedRowView(row: row)
                                    // D-03: solo nei Passati, un tocco segna "Ci sono stato".
                                    if filter == .past { visitedButton(row) }
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Rimuovi", role: .destructive) { remove(row) }
                            }
                            .accessibilityAction(named: "Rimuovi") { remove(row) }
                            .accessibilityActions {
                                if filter == .past {
                                    Button("Ci sono stato") { toggleVisited(row) }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .listRowSpacing(0)
            .environment(\.defaultMinListRowHeight, 0)
            .overlay { if !showSkeleton && days.isEmpty { emptyState } }
            .navigationTitle("Salvati")
            .navigationBarTitleDisplayMode(.large)
            // Sotto la barra di sistema il contenuto sfuma nel bordo morbido di iOS 26.
            .scrollEdgeEffectStyle(.soft, for: .top)
            // B2: con l'account, un menu di sistema nella barra (vetro tondo in alto a destra, come il Profilo).
            .toolbar {
                if signedIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button { sheet = .share } label: { Label("Condividi la lista", systemImage: "square.and.arrow.up") }
                            Button { sheet = .calendar } label: { Label("Iscriviti nel Calendario", systemImage: "calendar.badge.plus") }
                        } label: {
                            Image(systemName: "ellipsis")
                        }
                        .accessibilityLabel("Altre azioni")
                    }
                }
            }
            .sheet(item: $sheet) { which in
                switch which {
                case .share: ShareListSheet()
                case .calendar: CalendarFeedSheet()
                }
            }
            .task { await saves.reload() }
            .refreshable {
                await saves.reload()
                await visited.reload()
            }
            .sensoryFeedback(.selection, trigger: filter)
        }
    }

    // MARK: pezzi

    private func remove(_ row: SavedRow) {
        if filter == .visited {
            Task { await visited.remove(row) }
        } else {
            Task { await saves.remove(row, message: String(localized: "Rimosso dai salvati")) }
        }
    }

    private func toggleVisited(_ row: SavedRow) {
        Task { await visited.toggleFromSaved(row) }
    }

    /// Il segno a destra di una riga dei Passati: 44 pt, pieno e in accento quando l'evento e' segnato.
    private func visitedButton(_ row: SavedRow) -> some View {
        let marked = visited.isVisited(row: row)
        return Button { toggleVisited(row) } label: {
            Image(systemName: marked ? "checkmark.circle.fill" : "checkmark.circle")
                .font(.title2)
                .foregroundStyle(marked ? Color.accentToken : Color.mutedForeground)
                .frame(width: 44, height: 44)
        }
        // In una riga di List un Button di stile default si attiva con tutta la riga: borderless lo isola.
        .buttonStyle(.borderless)
        .accessibilityLabel("Ci sono stato")
        .accessibilityAddTraits(marked ? .isSelected : [])
        .sensoryFeedback(.success, trigger: visited.successCount)
        .sensoryFeedback(.warning, trigger: visited.warningCount)
        .sensoryFeedback(.error, trigger: visited.errorCount)
    }

    /// Prima riga della lista, sotto il titolo grande: il riepilogo in grigio e le chip.
    private func header(_ summary: String?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let summary {
                Text(verbatim: summary)
                    .font(.subheadline)
                    .foregroundStyle(Color.foregroundSecondary)
            }
            chips
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    /// "12 eventi · 3 questa settimana" (la parte della settimana solo nei Prossimi); nil se non c'e' nulla.
    private func summary(_ days: [SavedDay<SavedRow>], today: String) -> String? {
        let s = savedSummary(days, today: today)
        guard s.total > 0 else { return nil }
        let all = s.total == 1 ? String(localized: "1 evento") : String(localized: "\(s.total) eventi")
        guard filter == .upcoming, s.thisWeek > 0 else { return all }
        return all + " · " + String(localized: "\(s.thisWeek) questa settimana")
    }

    private var chips: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(Filter.allCases, id: \.self) { f in
                let selected = f == filter
                Button(f.title) { filter = f }
                    // In una riga di List due Button di stile default si attivano insieme (vince l'ultimo): borderless li separa.
                    .buttonStyle(.borderless)
                    .font(.label.weight(.semibold))
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .foregroundStyle(selected ? Color.white : Color.foreground)
                    .background(selected ? Color.accentToken : Color.surface, in: Capsule())
                    .accessibilityAddTraits(selected ? .isSelected : [])
            }
            Spacer()
            if let n = saves.guestCount, n >= 90 {
                Text("\(n) di 100").font(.label).foregroundStyle(Color.mutedForeground)
            }
        }
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
        timelineRow(last: false) {
            SavedRowView(row: SavedRow(
                entryID: 0, eventID: nil,
                snap: Snap(title: "Titolo dell'evento salvato", dateStart: "2026-01-01T00:00:00.000Z", dateEnd: nil, place: "Luogo", category: "Altro", source: "", sourceId: "", sourceUrl: nil),
                gone: false, prefix: "sk"))
                .redacted(reason: .placeholder)
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder private var emptyState: some View {
        if filter == .visited {
            ContentUnavailableView {
                Label("Nessun evento visitato", systemImage: "checkmark.circle")
            } description: {
                Text("Tocca \"Ci sono stato\" su un evento iniziato per ritrovarlo qui.")
            }
        } else if saves.loadFailed {
            ContentUnavailableView {
                Label("Salvati non disponibili", systemImage: "wifi.slash")
            } description: {
                Text("Non riusciamo a caricare i tuoi salvati. Controlla la connessione e riprova.")
            } actions: {
                Button("Riprova") { Task { await saves.reload() } }
            }
        } else if filter == .upcoming {
            ContentUnavailableView {
                Label("Nessun evento salvato", systemImage: "heart")
            } description: {
                Text("Tocca il cuore su un evento per ritrovarlo qui.")
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

    // MARK: timeline

    /// Intestazione di mese (quando cambia), intestazione del giorno, poi gli eventi del giorno.
    private func items(_ days: [SavedDay<SavedRow>]) -> [Item] {
        var out: [Item] = []
        for (i, day) in days.enumerated() {
            if let month = day.month { out.append(.month(month)) }
            out.append(.day(day))
            for (j, row) in day.items.enumerated() {
                out.append(.event(row, last: i == days.count - 1 && j == day.items.count - 1))
            }
        }
        return out
    }

    /// Una riga di timeline: a sinistra la linea verticale che collega i giorni, a destra il contenuto.
    private func timelineRow<Content: View>(
        rail: some View = EmptyView(), last: Bool, @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            ZStack(alignment: .top) {
                Color.surfaceStrong
                    .frame(width: Self.lineWidth)
                    .frame(maxHeight: last ? Spacing.xl : .infinity)
                rail
            }
            .frame(width: Self.tile.width)
            content()
        }
        .padding(.horizontal, Spacing.md)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    private func monthRow(_ title: String) -> some View {
        timelineRow(last: false) {
            Text(verbatim: title)
                .font(.heading)
                .foregroundStyle(Color.foreground)
                .padding(.top, Spacing.md)
                .padding(.bottom, Spacing.sm)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private func dayRow(_ day: SavedDay<SavedRow>) -> some View {
        let heading: String = day.isOngoing
            ? String(localized: "In corso")
            : day.day.map { formatTimelineDay($0, locale: .app) } ?? String(localized: "Senza data")
        return timelineRow(rail: dayTile(day), last: false) {
            Text(verbatim: heading)
                .font(.body)
                .foregroundStyle(Color.mutedForeground)
                .frame(height: Self.tile.height, alignment: .center)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.top, Spacing.sm)
    }

    /// Il numero del giorno grande e il giorno della settimana sotto; "In corso" e senza data hanno un simbolo.
    private func dayTile(_ day: SavedDay<SavedRow>) -> some View {
        VStack(spacing: 0) {
            if let d = day.day {
                let t = timelineDayTile(d, locale: .app)
                Text(verbatim: t.number).font(.title2.weight(.bold)).foregroundStyle(Color.foreground)
                Text(verbatim: t.weekday).font(.label).foregroundStyle(Color.mutedForeground)
            } else {
                Image(systemName: day.isOngoing ? "clock" : "calendar.badge.exclamationmark")
                    .font(.title3)
                    .foregroundStyle(Color.mutedForeground)
            }
        }
        .frame(width: Self.tile.width, height: Self.tile.height)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.md))
        .accessibilityHidden(true)
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
    @Environment(\.dynamicTypeSize) private var typeSize

    // Locandina grande della timeline; la misura di decodifica e' la stessa del riquadro.
    private static let photo = CGSize(width: 120, height: 150)

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
        Event(id: id, title: row.title, dateStart: row.dateStart, dateEnd: row.dateEnd, imageUrl: row.imageUrl, locationName: row.place, category: row.category)
    }

    private var content: some View {
        let visual = categoryVisual(row.category)
        return HStack(spacing: Spacing.md) {
            // Foto dell'evento (https) se c'e'; altrimenti il segnaposto di categoria.
            RemoteImage(url: row.imageUrl, category: row.category, size: Self.photo)
                .frame(width: Self.photo.width, height: Self.photo.height)
                .clipShape(RoundedRectangle(cornerRadius: Radius.card))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: row.title)
                    .font(.body.weight(.bold))
                    .foregroundStyle(Color.foreground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 3)
                ForEach([row.when, row.place ?? ""].filter { !$0.isEmpty }, id: \.self) { line in
                    Text(verbatim: line)
                        .font(.label)
                        .foregroundStyle(Color.foregroundSecondary)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                }
                if row.gone {
                    Text("Evento non più disponibile").font(.label).foregroundStyle(Color.mutedForeground)
                } else {
                    HStack(spacing: Spacing.xs) {
                        Circle().fill(visual.color).frame(width: 8, height: 8)
                        Text(verbatim: categoryLabel(row.category)).font(.label).foregroundStyle(Color.mutedForeground)
                    }
                    .accessibilityHidden(true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.sm)
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
