import Charts
import FuorirottaCore
import SwiftUI

// Statistiche personali (MOB-07, D-13/D-14): descrivono i salvati di chi guarda e si calcolano sul telefono.
// Niente rete in questo file e niente altro che i numeri dei propri salvati.

private let monthInitials = ["G", "F", "M", "A", "M", "G", "L", "A", "S", "O", "N", "D"]
private let monthNames = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]

/// Titolo di una scheda di statistica.
private struct StatCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(title).font(.heading).accessibilityAddTraits(.isHeader)
            content
        }
        .card()
    }
}

/// Le tre schede di Profilo > Statistiche, o lo stato vuoto.
struct StatsSection: View {
    let items: [StatItem]
    @State private var picked: Int?

    var body: some View {
        if let year = resolvedYear {
            let stats = computeStats(items, year: year)
            if stats.years.count > 1 {
                Picker("Anno", selection: Binding(get: { year }, set: { picked = $0 })) {
                    ForEach(stats.years, id: \.self) { Text(verbatim: String($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: year)
            }
            HeatmapCard(stats: stats, year: year)
            MonthChartCard(perMonth: stats.perMonth)
            CategoryBarsCard(rows: stats.perCategory)
        } else {
            ContentUnavailableView(
                "Ancora niente da mostrare",
                systemImage: "chart.bar",
                description: Text("Salva qualche evento: qui vedrai quando e cosa ti piace."))
                .card()
        }
    }

    private var resolvedYear: Int? {
        let years = computeStats(items, year: 0).years
        if let picked, years.contains(picked) { return picked }
        return defaultStatsYear(items, now: .now)
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
    private let cell: CGFloat = 16

    var body: some View {
        let heat = HeatWeeks(year: year, today: romeToday())
        StatCard(title: "Attività dell'anno") {
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
        let when = formatDayRange(from: day, to: day)
        return n == 0 ? "\(when), nessun evento salvato" : "\(when), \(n) \(n == 1 ? "evento salvato" : "eventi salvati")"
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

    func makeChartDescriptor() -> AXChartDescriptor {
        let x = AXCategoricalDataAxisDescriptor(title: xTitle, categoryOrder: names)
        let top = Double(max(values.max() ?? 1, 1))
        let y = AXNumericDataAxisDescriptor(
            title: "Eventi salvati", range: 0...top, gridlinePositions: [],
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

    var body: some View {
        let top = perMonth.max() ?? 0
        let peak = perMonth.firstIndex(of: top)
        let summary = top == 0
            ? "Nessun evento salvato in questo anno."
            : "Il mese con più eventi salvati è \(monthNames[peak!]): \(top)."
        StatCard(title: "Salvati per mese") {
            Chart(perMonth.indices, id: \.self) { m in
                BarMark(x: .value("Mese", monthNames[m]), y: .value("Eventi salvati", perMonth[m]))
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
                BarsDescriptor(title: "Salvati per mese", xTitle: "Mese", names: monthNames, values: perMonth, summary: summary))
            Text(summary).font(.label).foregroundStyle(Color.mutedForeground)
        }
    }
}

struct CategoryBarsCard: View {
    let rows: [(name: String, count: Int)]

    var body: some View {
        let top = Double(max(rows.map(\.count).max() ?? 1, 1))
        let summary = rows.first.map { "La categoria con più eventi salvati è \($0.name): \($0.count)." } ?? ""
        StatCard(title: "Salvati per categoria") {
            VStack(spacing: Spacing.md) {
                ForEach(rows, id: \.name) { row in
                    let visual = categoryVisual(row.name)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: visual.symbol).foregroundStyle(visual.color).accessibilityHidden(true)
                            Text(verbatim: row.name).font(.body).foregroundStyle(Color.foreground)
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
                    title: "Salvati per categoria", xTitle: "Categoria",
                    names: rows.map(\.name), values: rows.map(\.count), summary: summary))
        }
    }
}
