import FuorirottaCore
import SwiftUI

/// Primo avvio (D-12): spiega perche' serve la posizione PRIMA della richiesta del sistema. Si vede una volta sola.
struct LocationExplanationView: View {
    @Environment(LocationModel.self) private var location

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Spacer()
            // foreground, non accento: l'accento e' riservato (UI-SPEC, Color)
            Image(systemName: "location.circle")
                .font(.symbolHero)
                .foregroundStyle(Color.foreground)
                .accessibilityHidden(true)
            Text("Eventi vicino a te")
                .font(.heading)
                .foregroundStyle(Color.foreground)
                .multilineTextAlignment(.center)
            Text("Usiamo la tua posizione solo per mostrarti gli eventi più vicini. Non la salviamo sui nostri server.")
                .font(.body)
                .foregroundStyle(Color.foregroundSecondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button {
                location.requestPermission()
            } label: {
                Text("Consenti la posizione").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            Button("Non ora") { location.markExplained() }
                .buttonStyle(.plain)
                .foregroundStyle(Color.foregroundSecondary)
                .frame(minHeight: 44)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.background)
    }
}

/// "Cambia posizione" (Home e "Dove" della Ricerca): il telefono, un comune qualsiasi cercato in alto (/api/comuni/search,
/// come il campo "Dove" del sito, UAT7 C3), poi Milano e gli altri capoluoghi lombardi.
struct LocationPickerSheet: View {
    @Environment(LocationModel.self) private var location
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var search = PlaceSearch<ComuneOption> { try await $0.searchComuni(q: $1) }

    var body: some View {
        NavigationStack {
            List {
                if search.active {
                    Section { comuneRows }
                } else {
                    places
                }
            }
            .navigationTitle("Scegli la zona")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: Bindable(search).query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Cerca un comune"))
            .task(id: search.query) { await search.run(api) }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var comuneRows: some View {
        if search.failed {
            Text("Non riusciamo a cercare adesso. Riprova tra poco.").foregroundStyle(Color.mutedForeground)
        } else if let results = search.results {
            if results.isEmpty {
                Text("Nessun comune trovato per «\(search.trimmed)».").foregroundStyle(Color.mutedForeground)
            }
            ForEach(results) { comune in
                if let lat = comune.latitude, let lng = comune.longitude {
                    let place = Place(name: comune.name, latitude: lat, longitude: lng)
                    row(comune.name, detail: "\(comune.provinceName), \(comune.regionName)", symbol: "mappin.and.ellipse",
                        selected: location.selectedPlace == place, verbatim: true) {
                        location.select(place)
                    }
                }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var places: some View {
        Section {
            row(String(localized: "Usa la mia posizione"), symbol: "location.fill", selected: location.isUsingDevice) {
                location.requestPermission()
            }
        } footer: {
            if location.denied {
                Text("La posizione è disattivata nelle Impostazioni di iOS: finché resta così mostriamo Milano.")
            }
        }
        Section {
            // Un comune cercato prima resta in cima, con la spunta.
            if let chosen = location.selectedPlace, !Place.curated.contains(chosen) {
                row(chosen.name, symbol: "mappin.and.ellipse", selected: true, verbatim: true) { location.select(chosen) }
            }
            ForEach(Place.curated, id: \.name) { place in
                row(place.name, symbol: "mappin.and.ellipse", selected: location.selectedPlace == place, verbatim: true) {
                    location.select(place)
                }
            }
        }
    }

    private func row(
        _ title: String, detail: String? = nil, symbol: String, selected: Bool, verbatim: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button {
            action()
            withAnimation(Motion.spring) { dismiss() }
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: symbol).foregroundStyle(Color.mutedForeground).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Group { if verbatim { Text(verbatim: title) } else { Text(title) } }.foregroundStyle(Color.foreground)
                    if let detail { Text(verbatim: detail).font(.label).foregroundStyle(Color.mutedForeground) }
                }
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(Color.accentToken).accessibilityHidden(true) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
