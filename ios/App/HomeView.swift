import FuorirottaCore
import SwiftUI

/// Cosa mostra Home per un luogo: l'eroe del weekend e le file. Il caricamento e' qui, la vista disegna soltanto.
@MainActor @Observable
final class HomeModel {
    enum Phase { case loading, loaded, failed }

    private(set) var phase = Phase.loading
    private(set) var hero: [Event] = []
    private(set) var nearby: [Event] = []
    let window = weekendWindow()

    func load(api: APIClient, place: Place) async {
        // Un aggiornamento non svuota lo schermo: lo scheletro c'e' solo al primo caricamento.
        if phase == .failed { phase = .loading }
        do {
            // Le coordinate partono solo come lat/lng di GET /api/events (T-27-25), mai altrove.
            async let weekend = api.events(
                lat: place.latitude, lng: place.longitude, radiusKm: 50,
                dateFrom: window.from, dateTo: window.to, limit: 40)
            async let near = api.events(lat: place.latitude, lng: place.longitude, radiusKm: 50, limit: 16)
            let (w, n) = try await (weekend, near)
            hero = heroPicks(w.events)
            nearby = n.events
            phase = .loaded
        } catch {
            if !Task.isCancelled { phase = .failed }
        }
    }
}

struct HomeView: View {
    @Environment(\.api) private var api
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(LocationModel.self) private var location

    @State private var model = HomeModel()
    @State private var current: Int?
    @State private var topInset: CGFloat = 0
    @State private var showPlaceSheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    heroSection
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        if location.showsInactiveNotice {
                            Text("Posizione non attiva. Mostriamo gli eventi vicino a Milano: puoi cambiare zona in ogni momento.")
                                .font(.label)
                                .foregroundStyle(Color.mutedForeground)
                                .padding(.horizontal, Spacing.md)
                        }
                        rails
                    }
                    .padding(.top, Spacing.xl)
                    .padding(.bottom, Spacing.xl)
                }
            }
            // L'eroe sale fino al bordo alto, sotto la status bar (REF Omniphile): niente barra di navigazione.
            .ignoresSafeArea(edges: .top)
            .toolbar(.hidden, for: .navigationBar)
            .background(Color.background)
            .refreshable { await load() }
        }
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { topInset = $0 }
        .task(id: location.place) { await load() }
    }

    private func load() async {
        guard let api else { return }
        await model.load(api: api, place: location.place)
    }

    // MARK: Eroe e intestazione

    private var onPhoto: Bool { model.phase == .loaded && !model.hero.isEmpty }

    private var heroSection: some View {
        ZStack(alignment: .top) {
            heroContent
            if onPhoto {
                // Sfumatura in alto: il bianco dell'intestazione regge su qualunque foto.
                LinearGradient(colors: [Color.scrim.opacity(0.6), Color.scrim.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: topInset + 140)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .allowsHitTesting(false)
            }
            header
        }
    }

    @ViewBuilder private var heroContent: some View {
        switch model.phase {
        case .loading:
            Color.surface
                .frame(height: HeroCard.height + topInset)
                .accessibilityHidden(true)
        case .failed:
            Color.clear.frame(height: topInset + 96)
        case .loaded:
            if model.hero.isEmpty {
                // Eroe vuoto: si nasconde, resta l'intestazione e la riga "Nessun evento questo weekend".
                emptyWeekend.padding(.top, topInset + 96)
            } else {
                hero(model.hero)
            }
        }
    }

    private var header: some View {
        let ink: Color = onPhoto ? .white : Color.foreground
        let sub: Color = onPhoto ? .white.opacity(0.85) : Color.mutedForeground
        return HStack(alignment: .top, spacing: Spacing.md) {
            Button { showPlaceSheet = true } label: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("Questo weekend").font(.display).foregroundStyle(ink)
                    Text(verbatim: formatDayRange(from: model.window.from, to: model.window.to) + " · " + location.place.name)
                        .font(.label)
                        .foregroundStyle(sub)
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { showPlaceSheet = true } label: {
                Image(systemName: "location")
                    .font(.title3)
                    .foregroundStyle(Color.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Cambia posizione")
            .accessibilityHint("Apre la scelta della zona")
        }
        .padding(.horizontal, Spacing.md)
        .padding(.top, topInset + Spacing.sm)
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
        let index = picks.firstIndex { $0.id == current } ?? 0
        return VStack(spacing: Spacing.md) {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(picks) { event in
                        HeroCard(event: event, topInset: topInset)
                            .containerRelativeFrame(.horizontal)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $current)
            .scrollIndicators(.hidden)
            .onChange(of: index, initial: true) {
                // Le immagini delle due card successive sono pronte prima dello swipe.
                let next = picks.dropFirst(index + 1).prefix(2).compactMap(\.imageUrl)
                ImageLoader.prefetch(Array(next), size: HeroCard.imageSize)
            }
            if picks.count > 1 {
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

    // MARK: File

    @ViewBuilder private var rails: some View {
        switch model.phase {
        case .loading:
            railSkeleton
        case .failed:
            ContentUnavailableView {
                Label("Eventi non disponibili", systemImage: "wifi.slash")
            } description: {
                Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
            } actions: {
                Button("Riprova") { Task { await load() } }
            }
        case .loaded:
            railSection("Vicino a te", events: model.nearby)
        }
    }

    private func railTitle(_ title: String) -> some View {
        Text(title)
            .font(.heading)
            .foregroundStyle(Color.foreground)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, Spacing.md)
    }

    private func railSection(_ title: String, events: [Event]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            railTitle(title)
            if events.isEmpty {
                emptyRail
            } else {
                rail(events)
            }
        }
    }

    private func rail(_ events: [Event]) -> some View {
        ScrollView(.horizontal) {
            // Sempre orizzontale, anche con i testi piu' grandi: le schede crescono in altezza, non cambiano disposizione.
            LazyHStack(alignment: .top, spacing: Spacing.md) {
                ForEach(events) { RailCard(event: $0) }
            }
            .padding(.horizontal, Spacing.md)
        }
        .scrollIndicators(.hidden)
    }

    /// Stato vuoto sul modello del video: simbolo a linee grande, titolo in grassetto, una riga grigia.
    private var emptyRail: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(Color.mutedForeground)
                .accessibilityHidden(true)
            Text("Nessun evento qui intorno").font(.headline).foregroundStyle(Color.foreground)
            Text("Cambia posizione o guarda la mappa per scoprire cosa c'è in giro.")
                .font(.label)
                .foregroundStyle(Color.mutedForeground)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.md)
    }

    private var railSkeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            railTitle("Vicino a te")
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: Spacing.md) {
                    ForEach(0..<4, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            RoundedRectangle(cornerRadius: Radius.md).fill(Color.surface)
                                .frame(width: RailCard.width, height: RailCard.imageHeight)
                            Text("Titolo dell'evento in due righe").font(.body.weight(.semibold)).lineLimit(2)
                            Text("6-8 novembre · Luogo").font(.label)
                        }
                        .frame(width: RailCard.width, alignment: .topLeading)
                    }
                }
                .padding(.horizontal, Spacing.md)
            }
            .scrollIndicators(.hidden)
            .redacted(reason: .placeholder)
            .accessibilityHidden(true)
        }
    }
}
