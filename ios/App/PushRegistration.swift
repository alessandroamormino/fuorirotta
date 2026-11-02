import FuorirottaCore
import Observation
import UIKit
import UserNotifications

// Notifiche (Fase 27 registra il telefono; la Fase 28 si occupa di quali notifiche mandare).
// T-27-31: il token APNs vive solo in memoria e nel corpo di PUT/DELETE: mai in un indirizzo, in un log o su disco.

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Impostato da FuorirottaApp.init: l'adattatore crea il delegato da solo, senza dargli dipendenze.
    static var push: PushRegistration?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Self.push?.received(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("registrazione notifiche fallita: \(error.localizedDescription)")
    }
}

@MainActor @Observable
final class PushRegistration {
    /// Solo memoria (T-27-31).
    private(set) var token: String?
    /// Il server ha accettato il telefono in questo avvio.
    private(set) var registered = false
    /// iOS ha negato il permesso: il testo rimanda alle Impostazioni di iOS.
    private(set) var denied = false
    /// L'ultima registrazione chiesta dall'utente non e' riuscita.
    private(set) var failed = false
    /// Cambia a ogni "Notifiche attivate" mostrato: serve a .sensoryFeedback e all'avviso.
    private(set) var activatedCount = 0

    private var awaitingConfirmation = false
    private let api: APIClient
    private let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
    private let environment = Bundle.main.object(forInfoDictionaryKey: "FRApnsEnvironment") as? String ?? "production"

    init(api: APIClient) { self.api = api }

    /// "Attiva notifiche": chiede il permesso, poi registra il telefono. La conferma arriva col primo PUT riuscito.
    func enable() async {
        failed = false
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        denied = !granted
        guard granted else { return }
        awaitingConfirmation = true
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// A ogni avvio da connessi, e dopo ogni accesso: con il permesso gia' dato il telefono si registra di nuovo (PUT ad ogni avvio).
    func refreshIfAuthorised() async {
        guard api.bearer != nil else { return }
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        denied = status == .denied
        if status == .authorized || status == .provisional || status == .ephemeral {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Prima dell'uscita, con il bearer ancora valido. Un errore si registra e non blocca l'uscita.
    func unregister() async {
        guard let token else { return }
        do { try await api.unregisterDevice(token: token) } catch { print("rimozione dispositivo fallita: \(error)") }
        registered = false
    }

    /// Dopo l'eliminazione dell'account il server ha gia' tolto il telefono (cascata).
    func forget() {
        token = nil
        registered = false
        awaitingConfirmation = false
    }

    func received(_ data: Data) {
        let hex = apnsHex(data)
        token = hex
        guard api.bearer != nil else { return }
        Task { await register(hex) }
    }

    private func register(_ hex: String) async {
        do {
            try await api.registerDevice(token: hex, environment: environment, appVersion: version)
            registered = true
            if awaitingConfirmation {
                awaitingConfirmation = false
                activatedCount += 1
            }
        } catch {
            print("registrazione dispositivo fallita: \(error)")
            if awaitingConfirmation { awaitingConfirmation = false; failed = true }
        }
    }
}
