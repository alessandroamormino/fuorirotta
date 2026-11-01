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

/// "Cambia posizione": il telefono, poi Milano e gli altri capoluoghi lombardi (lista fissa, raggio fisso 50 km).
struct LocationPickerSheet: View {
    @Environment(LocationModel.self) private var location
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row("Usa la mia posizione", symbol: "location.fill", selected: location.isUsingDevice) {
                        location.requestPermission()
                    }
                } footer: {
                    if location.denied {
                        Text("La posizione è disattivata nelle Impostazioni di iOS: finché resta così mostriamo Milano.")
                    }
                }
                Section {
                    ForEach(Place.curated, id: \.name) { place in
                        row(place.name, symbol: "mappin.and.ellipse", selected: location.selectedCurated == place.name, verbatim: true) {
                            location.select(place)
                        }
                    }
                }
            }
            .navigationTitle("Scegli la zona")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ title: String, symbol: String, selected: Bool, verbatim: Bool = false, action: @escaping () -> Void) -> some View {
        Button {
            action()
            withAnimation(Motion.spring) { dismiss() }
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: symbol).foregroundStyle(Color.mutedForeground).frame(width: 28).accessibilityHidden(true)
                Group { if verbatim { Text(verbatim: title) } else { Text(title) } }.foregroundStyle(Color.foreground)
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(Color.accentToken).accessibilityHidden(true) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
