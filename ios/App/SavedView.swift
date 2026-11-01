import FuorirottaCore
import SwiftUI

struct SavedView: View {
    @Environment(SavesModel.self) private var saves

    var body: some View {
        NavigationStack {
            List(saves.rows) { row in
                SavedRowView(row: row)
                    .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .navigationTitle("Salvati")
            .task { await saves.reload() }
            .refreshable { await saves.reload() }
        }
    }
}

struct SavedRowView: View {
    let row: SavedRow

    var body: some View {
        let visual = categoryVisual(row.category)
        HStack(spacing: Spacing.md) {
            RemoteImage(url: nil, category: row.category, size: CGSize(width: 72, height: 72))
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: row.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.foreground)
                    .lineLimit(2)
                Text(verbatim: row.meta)
                    .font(.label)
                    .foregroundStyle(Color.foregroundSecondary)
                    .lineLimit(1)
                HStack(spacing: Spacing.xs) {
                    Circle().fill(visual.color).frame(width: 8, height: 8)
                    Text(verbatim: row.category).font(.label).foregroundStyle(Color.mutedForeground)
                }
                .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
