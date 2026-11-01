import FuorirottaCore
import SwiftUI

struct HomeView: View {
    @Environment(\.api) private var api
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Phase {
        case loading
        case loaded([Event])
        case failed
    }

    @State private var phase = Phase.loading
    @State private var current: Int?

    // Milano finche' 27-07 non aggiunge la posizione.
    private let lat = 45.4642
    private let lng = 9.19
    private let window = weekendWindow()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Text(verbatim: formatDayRange(from: window.from, to: window.to) + " · Milano")
                        .font(.label)
                        .foregroundStyle(Color.mutedForeground)
                        .padding(.horizontal, Spacing.md)
                    content
                }
            }
            .refreshable { await load() }
            .navigationTitle("Questo weekend")
        }
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            RoundedRectangle(cornerRadius: Radius.card)
                .fill(Color.surface)
                .frame(height: HeroCard.height)
                .padding(.horizontal, Spacing.md)
                .accessibilityHidden(true)
        case .failed:
            ContentUnavailableView {
                Label("Eventi non disponibili", systemImage: "wifi.slash")
            } description: {
                Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
            } actions: {
                Button("Riprova") { Task { await load() } }
            }
        case .loaded(let events):
            let picks = heroPicks(events)
            if picks.isEmpty {
                emptyWeekend
            } else {
                hero(picks)
            }
        }
    }

    private var emptyWeekend: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Nessun evento questo weekend").font(.heading).foregroundStyle(Color.foreground)
            Text("Prova ad allargare la zona: cambia posizione dal pulsante in alto.")
                .font(.body).foregroundStyle(Color.foregroundSecondary)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.card))
        .padding(.horizontal, Spacing.md)
    }

    private func hero(_ picks: [Event]) -> some View {
        let many = picks.count > 1
        let index = picks.firstIndex { $0.id == current } ?? 0
        return VStack(spacing: Spacing.md) {
            ScrollView(.horizontal) {
                LazyHStack(spacing: Spacing.sm) {
                    ForEach(picks) { event in
                        HeroCard(event: event)
                            // Un solo evento: margini uguali, niente anteprima. Piu' eventi: la successiva spunta di 16 pt.
                            .containerRelativeFrame(.horizontal) { w, _ in
                                many ? w - 2 * Spacing.md - Spacing.sm : w - 2 * Spacing.md
                            }
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $current)
            .contentMargins(.horizontal, Spacing.md, for: .scrollContent)
            .scrollIndicators(.hidden)
            .onChange(of: index, initial: true) {
                // Le immagini delle due card successive sono pronte prima dello swipe.
                let next = picks.dropFirst(index + 1).prefix(2).compactMap(\.imageUrl)
                ImageLoader.prefetch(Array(next), size: HeroCard.imageSize)
            }
            if many {
                HStack(spacing: Spacing.sm) {
                    ForEach(picks.indices, id: \.self) { i in
                        Circle()
                            .fill(i == index ? Color.foreground : Color.mutedForeground.opacity(0.4))
                            .frame(width: 8, height: 8)
                    }
                }
                .animation(reduceMotion ? .easeInOut : Motion.spring, value: index)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Evento \(index + 1) di \(picks.count)")
            }
        }
    }

    private func load() async {
        guard let api else { return }
        if case .loaded = phase {} else { phase = .loading } // un aggiornamento non svuota lo schermo
        do {
            let page = try await api.events(
                lat: lat, lng: lng, radiusKm: 50,
                dateFrom: window.from, dateTo: window.to, limit: 40
            )
            phase = .loaded(page.events)
        } catch {
            phase = .failed
        }
    }
}
