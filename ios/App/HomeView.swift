import FuorirottaCore
import SwiftUI

struct HomeView: View {
    @Environment(\.api) private var api

    private enum Phase {
        case loading
        case loaded([Event])
        case failed
    }

    @State private var phase = Phase.loading

    // Milano finche' 27-07 non aggiunge la posizione.
    private let lat = 45.4642
    private let lng = 9.19
    private let window = weekendWindow()

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .loading:
                    ProgressView()
                case .failed:
                    ContentUnavailableView {
                        Label("Eventi non disponibili", systemImage: "wifi.slash")
                    } description: {
                        Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
                    } actions: {
                        Button("Riprova") { Task { await load() } }
                    }
                case .loaded(let events):
                    List {
                        Section {
                            ForEach(events) { event in
                                row(event)
                            }
                        } header: {
                            Text(verbatim: formatDayRange(from: window.from, to: window.to) + " · Milano")
                                .font(.label)
                                .foregroundStyle(Color.mutedForeground)
                                .textCase(nil)
                        }
                    }
                }
            }
            .navigationTitle("Questo weekend")
        }
        .task { await load() }
    }

    private func row(_ event: Event) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(verbatim: event.title).font(.body.weight(.semibold)).foregroundStyle(Color.foreground)
            if let days = eventDays(dateStart: event.dateStart, dateEnd: event.dateEnd) {
                Text(verbatim: formatDayRange(from: days.from, to: days.to))
                    .font(.label).foregroundStyle(Color.mutedForeground)
            }
            if let place = event.locationName {
                Text(verbatim: place).font(.label).foregroundStyle(Color.mutedForeground)
            }
        }
    }

    private func load() async {
        guard let api else { return }
        phase = .loading
        do {
            let page = try await api.events(
                lat: lat, lng: lng, radiusKm: 50,
                dateFrom: window.from, dateTo: window.to, limit: 16
            )
            phase = .loaded(page.events)
        } catch {
            phase = .failed
        }
    }
}
