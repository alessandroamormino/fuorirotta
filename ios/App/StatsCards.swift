import Charts
import FuorirottaCore
import SwiftUI

// Statistiche personali (MOB-07, D-13/D-14): descrivono i visitati e i salvati di chi guarda e si calcolano sul telefono.
// Niente rete in questo file e niente altro che i numeri delle proprie liste.

private let monthCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.locale = .app
    return c
}()
private let monthInitials = monthCalendar.veryShortStandaloneMonthSymbols
private let monthNames = monthCalendar.standaloneMonthSymbols

/// Titolo di una scheda di statistica.
private struct StatCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(verbatim: title).font(.heading).accessibilityAddTraits(.isHeader)
            content
        }
        .card()
    }
}

enum Period: Hashable { case always, year }

/// Quale lista descrivono griglia e grafici (D-10).
enum StatsKind: Hashable { case visited, saved }

/// Le tre tessere in cima (D-09): Giorni fuori a tutta larghezza, Visitati e Salvati sotto. "Sempre | <anno>" (D-11).
struct StatsTilesView: View {
    let tiles: StatsTiles
    @Binding var period: Period
    let year: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: Spacing.md) {
            if let year {
                Picker("Periodo", selection: $period) {
                    Text("Sempre").tag(Period.always)
                    Text(verbatim: String(year)).tag(Period.year)
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: period)
            }
            tile(String(localized: "Giorni fuori"), tiles.daysOut, Color.accentToken)
            HStack(spacing: Spacing.md) {
                tile(String(localized: "Visitati"), tiles.visited, Color.accentToken)
                tile(String(localized: "Salvati"), tiles.saved, Color.heart)
            }
        }
    }

    private func tile(_ title: String, _ value: Int, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(verbatim: title).font(.label).foregroundStyle(Color.mutedForeground)
            Text(verbatim: "\(value)")
                .font(.display).monospacedDigit().foregroundStyle(color)
                .contentTransition(reduceMotion ? .identity : .numericText())
                .animation(reduceMotion ? nil : Motion.snappy, value: value)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(title): \(value)"))
    }
}

/// Le tessere e le tre schede di Profilo > Statistiche, o lo stato vuoto.
struct StatsSection: View {
    let visited: [VisitedStatItem]
    let saved: [StatItem]
    @State private var kind = StatsKind.visited
    @State private var picked: Int?
    @State private var period = Period.always

    var body: some View {
        let stats = { (year: Int) in kind == .visited ? computeVisitedStats(visited, year: year) : computeStats(saved, year: year) }
        let years = stats(0).years
        let year = resolvedYear(years)
        StatsTilesView(
            tiles: statsTiles(visited: visited, saved: saved, year: period == .year ? year : nil),
            period: $period, year: year)
        Picker("Statistiche di", selection: $kind) {
            Text("Visitati").tag(StatsKind.visited)
            Text("Salvati").tag(StatsKind.saved)
        }
        .pickerStyle(.segmented)
        .sensoryFeedback(.selection, trigger: kind)
        if let year {
            let current = stats(year)
            if years.count > 1 {
                Picker("Anno", selection: Binding(get: { year }, set: { picked = $0 })) {
                    ForEach(years, id: \.self) { Text(verbatim: String($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: year)
            }
            HeatmapCard(stats: current, year: year, kind: kind)
            MonthChartCard(perMonth: current.perMonth, kind: kind)
            CategoryBarsCard(rows: current.perCategory, kind: kind)
        } else {
            ContentUnavailableView(
                "Ancora niente da mostrare",
                systemImage: "chart.bar",
                description: kind == .visited
                    ? Text("Segna \"Ci sono stato\" su un evento: qui vedrai dove sei stato.")
                    : Text("Salva qualche evento: qui vedrai quando e cosa ti piace."))
                .card()
        }
    }

    /// Anno scelto se la lista ce l'ha; altrimenti l'anno corrente (Roma) se presente, altrimenti l'ultimo.
    private func resolvedYear(_ years: [Int]) -> Int? {
        if let picked, years.contains(picked) { return picked }
        let current = Rome.calendar.component(.year, from: .now)
        return years.contains(current) ? current : years.last
    }
}

// MARK: - Attivita' dell'anno

private struct HeatWeeks {
    /// Colonne = settimane da lunedi' a domenica; nil = giorno fuori dall'anno.
    let weeks: [[String?]]
    /// Indice della settimana -> mese (0-11) che inizia in quella settimana.
    let monthStarts: [Int: Int]
    let currentWeek: Int?

    init(year: Int, today: String) {
        var cal = Rome.calendar
        cal.firstWeekday = 2
        let jan1 = cal.date(from: DateComponents(year: year, month: 1, day: 1, hour: 12))!
        let dec31 = cal.date(from: DateComponents(year: year, month: 12, day: 31, hour: 12))!
        var cursor = cal.date(byAdding: .day, value: -((cal.component(.weekday, from: jan1) + 5) % 7), to: jan1)!
        var weeks: [[String?]] = []
        var starts: [Int: Int] = [:]
        var current: Int?
        while cursor <= dec31 {
            var week: [String?] = []
            for _ in 0..<7 {
                let c = cal.dateComponents([.year, .month, .day], from: cursor)
                if c.year == year {
                    let day = String(format: "%04d-%02d-%02d", year, c.month!, c.day!)
                    week.append(day)
                    if c.day == 1 { starts[weeks.count] = c.month! - 1 }
                    if day == today { current = weeks.count }
                } else {
                    week.append(nil)
                }
                cursor = cal.date(byAdding: .day, value: 1, to: cursor)!
            }
            weeks.append(week)
        }
        self.weeks = weeks
        monthStarts = starts
        currentWeek = current
    }
}

struct HeatmapCard: View {
    let stats: Stats
    let year: Int
    let kind: StatsKind
    private let cell: CGFloat = 16

    var body: some View {
        let heat = HeatWeeks(year: year, today: romeToday())
        StatCard(title: String(localized: "Attività dell'anno")) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: Spacing.xs) {
                        ForEach(heat.weeks.indices, id: \.self) { w in
                            VStack(spacing: Spacing.xs) {
                                Text(verbatim: heat.monthStarts[w].map { monthInitials[$0] } ?? " ")
                                    .font(.label)
                                    .foregroundStyle(Color.mutedForeground)
                                    .fixedSize()
                                    .frame(width: cell, alignment: .leading)
                                    .accessibilityHidden(true)
                                ForEach(0..<7, id: \.self) { d in
                                    dayCell(heat.weeks[w][d])
                                }
                            }
                            .id(w)
                        }
                    }
                }
                .task(id: year) {
                    // Anno in corso: la settimana di oggi; un anno passato: l'ultima settimana.
                    proxy.scrollTo(heat.currentWeek ?? heat.weeks.count - 1, anchor: .center)
                }
            }
            legend
        }
    }

    @ViewBuilder private func dayCell(_ day: String?) -> some View {
        if let day {
            let n = stats.days[day] ?? 0
            RoundedRectangle(cornerRadius: Radius.cell)
                .fill(fill(heatLevel(n)))
                .frame(width: cell, height: cell)
                .accessibilityElement()
                .accessibilityLabel(label(day, n))
        } else {
            Color.clear.frame(width: cell, height: cell)
        }
    }

    private func fill(_ level: Int) -> Color {
        level == 0 ? Color.surfaceStrong : Color.accentToken.opacity([0, 0.30, 0.55, 0.80, 1.0][level])
    }

    private func label(_ day: String, _ n: Int) -> String {
        let when = formatDayRange(from: day, to: day, locale: .app)
        switch (n, kind) {
        case (0, .visited): return String(localized: "\(when), nessun evento visitato")
        case (0, .saved): return String(localized: "\(when), nessun evento salvato")
        case (1, .visited): return String(localized: "\(when), 1 evento visitato")
        case (1, .saved): return String(localized: "\(when), 1 evento salvato")
        case (_, .visited): return String(localized: "\(when), \(n) eventi visitati")
        case (_, .saved): return String(localized: "\(when), \(n) eventi salvati")
        }
    }

    private var legend: some View {
        HStack(spacing: Spacing.xs) {
            Text("Meno").font(.label).foregroundStyle(Color.mutedForeground)
            ForEach(0..<5, id: \.self) { level in
                RoundedRectangle(cornerRadius: Radius.cell).fill(fill(level)).frame(width: cell, height: cell)
            }
            Text("Più").font(.label).foregroundStyle(Color.mutedForeground)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Per mese e per categoria

/// Descrittore per il grafico audio di VoiceOver: una serie di barre con nome e valore.
private struct BarsDescriptor: AXChartDescriptorRepresentable {
    let title: String
    let xTitle: String
    let names: [String]
    let values: [Int]
    let summary: String
    let valueTitle: String

    func makeChartDescriptor() -> AXChartDescriptor {
        let x = AXCategoricalDataAxisDescriptor(title: xTitle, categoryOrder: names)
        let top = Double(max(values.max() ?? 1, 1))
        let y = AXNumericDataAxisDescriptor(
            title: valueTitle, range: 0...top, gridlinePositions: [],
            valueDescriptionProvider: { "\(Int($0))" })
        let series = AXDataSeriesDescriptor(
            name: title, isContinuous: false,
            dataPoints: zip(names, values).map { AXDataPoint(x: $0, y: Double($1)) })
        return AXChartDescriptor(title: title, summary: summary, xAxis: x, yAxis: y, additionalAxes: [], series: [series])
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {}
}

struct MonthChartCard: View {
    let perMonth: [Int]
    let kind: StatsKind

    var body: some View {
        let top = perMonth.max() ?? 0
        let peak = perMonth.firstIndex(of: top)
        let visited = kind == .visited
        let summary = top == 0
            ? (visited ? String(localized: "Nessun evento visitato in questo anno.") : String(localized: "Nessun evento salvato in questo anno."))
            : (visited
                ? String(localized: "Il mese con più eventi visitati è \(monthNames[peak!]): \(top).")
                : String(localized: "Il mese con più eventi salvati è \(monthNames[peak!]): \(top)."))
        let title = visited ? String(localized: "Visitati per mese") : String(localized: "Salvati per mese")
        let valueTitle = visited ? String(localized: "Eventi visitati") : String(localized: "Eventi salvati")
        StatCard(title: title) {
            Chart(perMonth.indices, id: \.self) { m in
                BarMark(x: .value("Mese", monthNames[m]), y: .value(valueTitle, perMonth[m]))
                    .foregroundStyle(Color.accentToken)
                    .cornerRadius(Radius.cell)
                    .annotation(position: .top) {
                        if m == peak, top > 0 {
                            Text(verbatim: "\(top)").font(.label).monospacedDigit().foregroundStyle(Color.foreground)
                        }
                    }
            }
            .chartXAxis {
                AxisMarks(values: monthNames) { value in
                    AxisValueLabel {
                        if let name = value.as(String.self), let i = monthNames.firstIndex(of: name) {
                            Text(verbatim: monthInitials[i]).font(.label)
                        }
                    }
                }
            }
            .chartYAxis(.hidden)
            .frame(height: 160)
            .accessibilityChartDescriptor(
                BarsDescriptor(title: title, xTitle: String(localized: "Mese"), names: monthNames, values: perMonth, summary: summary, valueTitle: valueTitle))
            Text(summary).font(.label).foregroundStyle(Color.mutedForeground)
        }
    }
}

struct CategoryBarsCard: View {
    let rows: [(name: String, count: Int)]
    let kind: StatsKind

    var body: some View {
        let top = Double(max(rows.map(\.count).max() ?? 1, 1))
        let visited = kind == .visited
        let summary = rows.first.map {
            visited
                ? String(localized: "La categoria con più eventi visitati è \(categoryLabel($0.name)): \($0.count).")
                : String(localized: "La categoria con più eventi salvati è \(categoryLabel($0.name)): \($0.count).")
        } ?? ""
        let title = visited ? String(localized: "Visitati per categoria") : String(localized: "Salvati per categoria")
        let valueTitle = visited ? String(localized: "Eventi visitati") : String(localized: "Eventi salvati")
        StatCard(title: title) {
            VStack(spacing: Spacing.md) {
                ForEach(rows, id: \.name) { row in
                    let visual = categoryVisual(row.name)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: visual.symbol).foregroundStyle(visual.color).accessibilityHidden(true)
                            Text(verbatim: categoryLabel(row.name)).font(.body).foregroundStyle(Color.foreground)
                            Spacer()
                            Text(verbatim: "\(row.count)").font(.body).monospacedDigit().foregroundStyle(Color.foregroundSecondary)
                        }
                        GeometryReader { geo in
                            Capsule().fill(visual.color)
                                .frame(width: max(geo.size.width * Double(row.count) / top, Spacing.sm))
                        }
                        .frame(height: Spacing.sm)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .accessibilityChartDescriptor(
                BarsDescriptor(
                    title: title, xTitle: String(localized: "Categoria"),
                    names: rows.map { categoryLabel($0.name) }, values: rows.map(\.count), summary: summary, valueTitle: valueTitle))
        }
    }
}
