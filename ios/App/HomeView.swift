import FuorirottaCore
import SwiftUI

/// Cosa mostra Home per un luogo: l'eroe del weekend e le file. Il caricamento e' qui, la vista disegna soltanto.
@MainActor @Observable
final class HomeModel {
    enum Phase { case loading, loaded, failed }

    private(set) var phase = Phase.loading
    private(set) var hero: [Event] = []
    private(set) var nearby: [Event] = []
    /// Quanti eventi ci sono nel raggio (`total` del server), non solo i 16 della fila.
    private(set) var nearbyTotal: Int?
    /// "Per te": nil = non caricato (ospite) o non riuscito (`forYouFailed`).
    private(set) var forYou: FeedPage?
    private(set) var forYouFailed = false
    private(set) var followCount = 0  // contatore per .sensoryFeedback(.selection)
    /// Rete assente: si mostra l'ultimo Home riuscito per questo luogo, con l'avviso "Sei offline...".
    private(set) var offline = false
    let window = weekendWindow()

    func load(api: APIClient, place: Place, signedIn: Bool) async {
        // Un aggiornamento non svuota lo schermo: lo scheletro c'e' solo al primo caricamento.
        if phase == .failed { phase = .loading }
        do {
            // Le coordinate partono solo come lat/lng di GET /api/events (T-27-25), mai altrove.
            async let weekend = api.events(
                lat: place.latitude, lng: place.longitude, radiusKm: 50,
                dateFrom: window.from, dateTo: window.to, limit: 40)
            async let near = api.events(lat: place.latitude, lng: place.longitude, radiusKm: 50, limit: 16)
            // Il feed e' un'altra rotta (bearer, nessuna posizione): se fallisce non toglie il resto di Home.
            async let feed: FeedPage? = signedIn ? try? await api.feed(limit: 16, offset: 0) : nil
            let (w, n, f) = try await (weekend, near, feed)
            if Task.isCancelled { return }
            hero = heroPicks(w.events)
            nearby = n.events
            nearbyTotal = n.total
            forYou = f
            forYouFailed = signedIn && f == nil
            offline = false
            phase = .loaded
            Self.write(Snapshot(hero: hero, nearby: nearby, nearbyTotal: nearbyTotal), for: place)
        } catch {
            guard !Task.isCancelled else { return }
            if let cached = Self.read(for: place) {
                hero = cached.hero
                nearby = cached.nearby
                nearbyTotal = cached.nearbyTotal
                forYou = nil
                forYouFailed = signedIn
                offline = true
                phase = .loaded
            } else {
                phase = .failed
            }
        }
    }

    // Solo dati pubblici (eroe e fila dei dintorni), uno per luogo: niente dell'account va su disco.
    private struct Snapshot: Codable {
        let hero: [Event]
        let nearby: [Event]
        let nearbyTotal: Int?
    }

    private static func url(for place: Place) -> URL {
        let slug = place.name.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        return URL.cachesDirectory.appending(path: "fuorirotta/home-\(slug).json")
    }

    private static func write(_ snapshot: Snapshot, for place: Place) {
        let target = url(for: place)
        // ponytail: scrittura fallita = niente cache offline, nient'altro.
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(snapshot) { try? data.write(to: target, options: .atomic) }
    }

    private static func read(for place: Place) -> Snapshot? {
        guard let data = try? Data(contentsOf: url(for: place)) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    /// Zero seguiti: un tocco su una categoria la segue e ricarica la fila (un 401 lo gestisce Session).
    func follow(api: APIClient, category: String) async {
        do {
            try await api.follow(kind: "category", key: category)
            forYou = try await api.feed(limit: 16, offset: 0)
            forYouFailed = false
            followCount += 1
        } catch {}  // il tocco non e' andato a buon fine: la fila resta com'era e si puo' ritoccare
    }
}

struct HomeView: View {
    @Environment(\.api) private var api
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.scenePhase) private var scenePhase
    @Environment(LocationModel.self) private var location
    @Environment(Session.self) private var session
    @Environment(\.appConfig) private var appConfig
    @Environment(\.openURL) private var openURL
    @Environment(Router.self) private var router

    @State private var dismissedRecommended = UserDefaults.standard.string(forKey: "fr.dismissedRecommended")
    @State private var model = HomeModel()
    @State private var current: Int?
    @State private var heroVisible = true
    @State private var scrollBusy = false
    @State private var scrollTouches = 0
    @State private var topInset: CGFloat = 0
    @State private var showPlaceSheet = false
    @State private var showSettings = false

    var body: some View {
        EventStack(path: Bindable(router).homePath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    heroSection
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        if model.offline {
                            Label("Sei offline. Mostriamo gli ultimi dati salvati.", systemImage: "wifi.slash")
                                .font(.label)
                                .foregroundStyle(Color.foregroundSecondary)
                                .card()
                                .padding(.horizontal, Spacing.md)
                        }
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
        .sheet(isPresented: $showPlaceSheet) { LocationPickerSheet() }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { topInset = $0 }
        .task(id: LoadKey(place: location.place, signedIn: signedIn)) { await load() }
        .sensoryFeedback(.selection, trigger: model.followCount)
    }

    private struct LoadKey: Equatable {
        let place: Place
        let signedIn: Bool
    }

    private var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    private func load() async {
        guard let api else { return }
        await model.load(api: api, place: location.place, signedIn: signedIn)
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
            Color.clear.frame(height: headerReserve)
        case .loaded:
            if model.hero.isEmpty {
                // Eroe vuoto: si nasconde, resta l'intestazione e la riga "Nessun evento questo weekend".
                emptyWeekend.padding(.top, headerReserve)
            } else {
                hero(model.hero)
            }
        }
    }

    /// "È disponibile una nuova versione.": sopra l'eroe, si chiude con "Più tardi" (ricordato per versione consigliata).
    private var showsUpdateBanner: Bool {
        guard appConfig?.status == .updateRecommended else { return false }
        return dismissedRecommended == nil || dismissedRecommended != appConfig?.recommendedVersion
    }

    private var updateBanner: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("È disponibile una nuova versione.").font(.label).foregroundStyle(Color.foreground)
            HStack(spacing: Spacing.md) {
                Button("Aggiorna") { openURL(updateURL) }
                    .font(.label.weight(.semibold))
                    .foregroundStyle(Color.accentToken)
                Button("Più tardi") {
                    dismissedRecommended = appConfig?.recommendedVersion ?? ""
                    UserDefaults.standard.set(dismissedRecommended, forKey: "fr.dismissedRecommended")
                }
                .font(.label)
                .foregroundStyle(Color.foregroundSecondary)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Radius.card))
    }

    private var header: some View {
        let ink: Color = onPhoto ? .white : Color.foreground
        let sub: Color = onPhoto ? .white.opacity(0.85) : Color.mutedForeground
        return VStack(spacing: Spacing.sm) {
            HStack(alignment: .top, spacing: Spacing.md) {
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
                // Capsula di vetro in alto a destra (REF Omniphile): zona | impostazioni, due azioni in un solo gruppo.
                GlassEffectContainer {
                    HStack(spacing: 0) {
                        Button { showPlaceSheet = true } label: { capsuleIcon("location") }
                            .accessibilityLabel("Cambia posizione")
                            .accessibilityHint("Apre la scelta della zona")
                        Button { showSettings = true } label: { capsuleIcon("gearshape") }
                            .accessibilityLabel("Impostazioni")
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                }
            }
            if showsUpdateBanner { updateBanner }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.top, topInset + Spacing.sm)
    }

    private func capsuleIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.title3)
            .foregroundStyle(Color.primary)
            .frame(width: 48, height: 44)
            .contentShape(Rectangle())
    }

    /// Altezza riservata all'intestazione quando sotto non c'e' la foto.
    private var headerReserve: CGFloat { topInset + 96 + (showsUpdateBanner ? 96 : 0) }

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

    /// Id della copia della prima slide in fondo al carosello: arrivarci chiude il giro verso destra, poi si torna
    /// alla vera prima slide senza animazione (nessun riavvolgimento all'indietro). Gli id degli eventi sono positivi.
    private static let loopID = -1
    private static let autoSeconds = 4.0

    /// Movimento permesso: niente con "Riduci movimento" e niente con VoiceOver (ne' scala ne' avanzamento).
    private var motionOK: Bool { !reduceMotion && !voiceOver }

    /// L'avanzamento automatico gira solo se l'eroe si vede e nessuno lo sta usando.
    private var autoplay: Bool {
        motionOK && heroVisible && scenePhase == .active && router.tab == .home && router.homePath.isEmpty
            && !showSettings && !showPlaceSheet && !scrollBusy
    }

    private struct AutoKey: Hashable {
        let current: Int?
        let touches: Int
        let on: Bool
    }

    private func hero(_ picks: [Event]) -> some View {
        let index = picks.firstIndex { $0.id == current } ?? 0
        // La copia di chiusura c'e' solo dove il carosello puo' girare da solo.
        let looping = motionOK && picks.count > 1
        return VStack(spacing: Spacing.md) {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(picks) { event in
                        HeroCard(event: event, topInset: topInset, zooming: motionOK && (current ?? picks[0].id) == event.id)
                            .containerRelativeFrame(.horizontal)
                    }
                    if looping, let first = picks.first {
                        HeroCard(event: first, topInset: topInset, slot: "hero-loop", zooming: motionOK && current == Self.loopID)
                            .containerRelativeFrame(.horizontal)
                            .id(Self.loopID)
                            .accessibilityHidden(true)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $current)
            .scrollIndicators(.hidden)
            // Toccare o trascinare ferma l'avanzamento; ogni cambio di fase fa ripartire il conto dei 4 secondi.
            .onScrollPhaseChange { old, phase in
                scrollBusy = phase == .tracking || phase == .interacting || phase == .decelerating
                // Lo scorrimento che facciamo noi (.animating) non e' un tocco: non azzera il conto.
                if old != .animating, phase != .animating { scrollTouches += 1 }
            }
            .task(id: AutoKey(current: current, touches: scrollTouches, on: autoplay)) {
                guard looping, autoplay, let first = picks.first else { return }
                if current == Self.loopID {
                    // Siamo sulla copia: dopo la fine dello scorrimento si torna alla prima vera, senza animazione.
                    try? await Task.sleep(for: .seconds(0.6))
                    guard !Task.isCancelled else { return }
                    var t = Transaction(animation: nil)
                    t.disablesAnimations = true
                    withTransaction(t) { current = first.id }
                    return
                }
                try? await Task.sleep(for: .seconds(Self.autoSeconds))
                guard !Task.isCancelled else { return }
                let next = index + 1 < picks.count ? picks[index + 1].id : Self.loopID
                withAnimation(.easeInOut(duration: 0.5)) { current = next }
            }
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
        // Fuori schermo (altra scheda a parte, vedi `autoplay`) o scorso in basso: niente avanzamento.
        .onScrollVisibilityChange(threshold: 0.4) { heroVisible = $0 }
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
            if signedIn { forYouSection }
            railSection(
                "Vicino a te", events: model.nearby, style: .poster, icon: "location.fill", iconColor: .success,
                count: model.nearbyTotal, subtitle: "Entro 50 km da \(location.place.name)",
                list: .nearby(location.place))
            if !signedIn { inviteCard }
        }
    }

    @ViewBuilder private var forYouSection: some View {
        if let page = model.forYou {
            if page.follows == 0 {
                chooseCategories
            } else if page.items.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    railTitle("Per te")
                    emptyRow(
                        symbol: "calendar.badge.clock", title: "Niente in programma",
                        line: "Non ci sono eventi in arrivo per quello che segui.")
                }
            } else {
                railSection(
                    "Per te", events: page.items, style: .wide, icon: "sparkles", count: page.total,
                    subtitle: "Scelti da quello che segui", list: .forYou)
            }
        } else if model.forYouFailed {
            VStack(alignment: .leading, spacing: Spacing.md) {
                railTitle("Per te")
                emptyRow(
                    symbol: "wifi.slash", title: "Per te non è disponibile",
                    line: "Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
            }
        }
    }

    private var chooseCategories: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            railTitle("Per te")
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Scegli cosa ti piace").font(.headline).foregroundStyle(Color.foreground)
                Text("Tocca le categorie che segui e qui compariranno gli eventi scelti per te.")
                    .font(.label)
                    .foregroundStyle(Color.mutedForeground)
            }
            .padding(.horizontal, Spacing.md)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Spacing.sm)], spacing: Spacing.sm) {
                ForEach(ApiContract.categories, id: \.self) { name in
                    Button {
                        guard let api else { return }
                        Task { await model.follow(api: api, category: name) }
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Circle().fill(categoryVisual(name).color).frame(width: 8, height: 8)
                            Text(verbatim: name).font(.label).foregroundStyle(Color.foreground).lineLimit(2)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, Spacing.md)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .background(Color.surface, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Spacing.md)
        }
    }

    /// Ospite: invito ad accedere, mai un blocco. Il foglio di accesso e' lo stesso di Salvati e Profilo.
    private var inviteCard: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Image(systemName: "sparkles").font(.symbolCard).foregroundStyle(Color.foreground).accessibilityHidden(true)
            Text("Accedi per avere eventi scelti per te").font(.heading).foregroundStyle(Color.foreground)
            Text("Salva gli eventi che ti interessano e scegli le categorie che segui.")
                .font(.body)
                .foregroundStyle(Color.foregroundSecondary)
                .padding(.bottom, Spacing.sm)
            Button {
                session.presentSignIn = true
            } label: {
                Text("Accedi").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .card()
        .padding(.horizontal, Spacing.md)
    }

    private func railTitle(_ title: String) -> some View {
        Text(title)
            .font(.heading)
            .foregroundStyle(Color.foreground)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, Spacing.md)
    }

    private enum RailStyle { case poster, wide }

    /// Titolo in grassetto con il chevron (REF Omniphile) e "Vedi tutto": apre l'elenco della stessa fonte, fino a 100.
    /// Con `icon`, `count` e `subtitle` l'intestazione e' quella delle file larghe ("Per te"); senza, quella delle locandine.
    private func railSection(
        _ title: String, events: [Event], style: RailStyle, icon: String? = nil, iconColor: Color = .accentToken, count: Int? = nil, subtitle: String? = nil,
        list: EventListRoute.Source
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            NavigationLink(value: EventListRoute(title: title, source: list)) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    HStack(spacing: Spacing.sm) {
                        if let icon { SettingsTile(symbol: icon, color: iconColor) }
                        Text(title).font(.heading).foregroundStyle(Color.foreground)
                        Image(systemName: "chevron.right").font(.label.weight(.semibold)).foregroundStyle(Color.foreground)
                            .accessibilityHidden(true)
                        if let count {
                            Text(verbatim: count == 1 ? "1 evento" : "\(count) eventi")
                                .font(.label)
                                .foregroundStyle(Color.mutedForeground)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text("Vedi tutto").font(.label.weight(.semibold)).foregroundStyle(Color.accentToken).fixedSize()
                    }
                    if let subtitle {
                        Text(subtitle).font(.label).foregroundStyle(Color.mutedForeground)
                    }
                }
                .padding(.horizontal, Spacing.md)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            if events.isEmpty {
                emptyRow(
                    symbol: "calendar.badge.exclamationmark", title: "Nessun evento qui intorno",
                    line: "Cambia posizione o guarda la mappa per scoprire cosa c'è in giro.")
            } else {
                rail(events, style: style)
            }
        }
    }

    private func rail(_ events: [Event], style: RailStyle) -> some View {
        ScrollView(.horizontal) {
            // Sempre orizzontale, anche con i testi piu' grandi: le schede crescono in altezza, non cambiano disposizione.
            LazyHStack(alignment: .top, spacing: Spacing.md) {
                switch style {
                case .poster: ForEach(events) { PosterCard(event: $0) }
                case .wide: ForEach(events) { WideCard(event: $0) }
                }
            }
            .padding(.horizontal, Spacing.md)
        }
        .scrollIndicators(.hidden)
    }

    /// Stato vuoto sul modello del video: simbolo a linee grande, titolo in grassetto, una riga grigia.
    private func emptyRow(symbol: String, title: String, line: String) -> some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(Color.mutedForeground)
                .accessibilityHidden(true)
            Text(title).font(.headline).foregroundStyle(Color.foreground)
            Text(line)
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
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("1 nov").font(.label.weight(.semibold))
                            RoundedRectangle(cornerRadius: Radius.media).fill(Color.surface)
                                .frame(width: PosterCard.width, height: PosterCard.height)
                        }
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
