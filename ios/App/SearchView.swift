import SwiftUI

/// Scheda Cerca: `.searchable` dentro la scheda con ruolo search fa disegnare a iOS 26 la pillola di vetro in basso
/// che si espande a ricerca a tutto schermo. Risultati e ricerche recenti arrivano con 27-08.
struct SearchView: View {
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ContentUnavailableView.search
                .navigationTitle("Cerca")
        }
        .searchable(text: $query, prompt: "Cerca eventi")
    }
}
