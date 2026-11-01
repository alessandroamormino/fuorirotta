import FuorirottaCore
import SwiftUI

/// Il foglio dei filtri di Cerca (come il sito): Quando, Dove, Categorie. Ogni scelta si applica subito ai risultati.
struct SearchFiltersSheet: View {
    @Binding var filters: SearchFilters

    @Environment(LocationModel.self) private var location
    @Environment(\.dismiss) private var dismiss
    @State private var showPlaceSheet = false

    private static let radii = [10, 25, 50, 100]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    whenGroup
                    whereGroup
                    categoriesGroup
                    if filters.hasFilters {
                        Button("Azzera i filtri", role: .destructive) {
                            withAnimation(Motion.snappy) {
                                filters.when = .any
                                filters.near = nil
                                filters.categories = []
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .padding(Spacing.md)
            }
            .background(Color.background)
            .navigationTitle("Filtri")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(role: .confirm) { dismiss() } }
            }
            .sheet(isPresented: $showPlaceSheet) { LocationPickerSheet() }
        }
        .presentationDetents([.medium, .large])
    }

    private func group<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.mutedForeground)
                .padding(.horizontal, Spacing.md)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: Spacing.md) { content() }.card()
        }
    }

    // MARK: Quando

    private var isCustom: Bool {
        if case .custom = filters.when { return true }
        return false
    }

    private var whenGroup: some View {
        group("Quando") {
            ForEach([SearchFilters.When.any, .today, .weekend, .next7], id: \.self) { option in
                optionRow(option.title(locale: .app), selected: filters.when == option) { filters.when = option }
            }
            optionRow("Scegli le date", selected: isCustom) {
                if !isCustom { filters.when = .custom(from: romeToday(), to: romeToday()) }
            }
            if case .custom(let from, let to) = filters.when {
                DatePicker("Dal", selection: dateBinding(from, isFrom: true), displayedComponents: .date)
                DatePicker("Al", selection: dateBinding(to, isFrom: false), in: date(from)..., displayedComponents: .date)
            }
        }
        // I giorni sono quelli di Roma, come ovunque nell'app.
        .environment(\.calendar, Rome.calendar)
        .environment(\.timeZone, Rome.calendar.timeZone)
    }

    private func date(_ day: String) -> Date {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let d = Rome.calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) else { return .now }
        return d
    }

    private func dateBinding(_ day: String, isFrom: Bool) -> Binding<Date> {
        Binding(
            get: { date(day) },
            set: { new in
                guard case .custom(let from, let to) = filters.when else { return }
                let picked = romeToday(now: new)
                filters.when = isFrom ? .custom(from: picked, to: max(picked, to)) : .custom(from: from, to: picked)
            })
    }

    // MARK: Dove

    private var whereGroup: some View {
        group("Dove") {
            Picker("Dove", selection: nearBinding) {
                Text("Ovunque").tag(false)
                Text(verbatim: "Vicino a \(location.place.name)").tag(true)
            }
            .pickerStyle(.segmented)
            if let near = filters.near {
                Picker("Raggio", selection: Binding(
                    get: { near.radiusKm }, set: { filters.near?.radiusKm = $0 })
                ) {
                    ForEach(Self.radii, id: \.self) { Text(verbatim: "\($0) km").tag($0) }
                }
                .pickerStyle(.segmented)
                Button { showPlaceSheet = true } label: {
                    Label("Cambia zona o usa la mia posizione", systemImage: "location")
                        .font(.label.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .foregroundStyle(Color.accentToken)
            }
        }
    }

    private var nearBinding: Binding<Bool> {
        Binding(
            get: { filters.near != nil },
            set: { on in
                let place = location.place
                filters.near = on ? SearchFilters.Near(lat: place.latitude, lng: place.longitude, radiusKm: filters.near?.radiusKm ?? 25) : nil
            })
    }

    // MARK: Categorie

    private var categoriesGroup: some View {
        group("Categorie") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Spacing.sm)], spacing: Spacing.sm) {
                ForEach(ApiContract.categories, id: \.self) { name in
                    let on = filters.categories.contains(name)
                    Button {
                        if on { filters.categories.removeAll { $0 == name } } else { filters.categories.append(name) }
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Circle().fill(on ? Color.white : categoryVisual(name).color).frame(width: 8, height: 8)
                            Text(verbatim: name).font(.label).foregroundStyle(on ? Color.white : Color.foreground).lineLimit(2)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, Spacing.md)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .background(on ? Color.accentToken : Color.surfaceStrong, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .sensoryFeedback(.selection, trigger: filters.categories)
        }
    }

    private func optionRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(verbatim: title).foregroundStyle(Color.foreground)
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(Color.accentToken).accessibilityHidden(true) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
