import EventKit
import EventKitUI
import FuorirottaCore
import SwiftUI

/// "Aggiungi al calendario" (UAT7 A2): il foglio di sistema precompilato. Da iOS 17 gira fuori dal processo e salva
/// senza chiedere il permesso al calendario: nessuna `requestFullAccess`, nessuna lettura dei calendari.
struct EventEditSheet: UIViewControllerRepresentable {
    let draft: CalendarDraft
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = draft.title
        event.location = draft.location.isEmpty ? nil : draft.location
        event.notes = draft.notes
        event.url = draft.url
        event.isAllDay = draft.isAllDay
        event.timeZone = draft.timeZone
        event.startDate = draft.start
        event.endDate = draft.end
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onDone: () -> Void
        init(onDone: @escaping () -> Void) { self.onDone = onDone }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            onDone()
        }
    }
}
