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
