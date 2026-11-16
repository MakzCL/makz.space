import UIKit
import UserNotifications

/// Apple push for SEND: asks permission when the page requests it, registers with APNs and hands the token to the page.
/// Tapping a notification opens its conversation.
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()
    /// Called with a JSON-able reply for the page ({type: "push:token" | "push:denied" | "push:unavailable", ...}).
    var send: (([String: Any]) -> Void)?
    /// Called with a SEND path (e.g. /channels/@me/123) when a notification is tapped.
    var open: ((String) -> Void)?
    private var pendingOpen: String?

    func start() { UNUserNotificationCenter.current().delegate = self }

    /// enable: may show the system prompt. sync: only refreshes the token if permission was already given.
    func handle(_ type: String) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            DispatchQueue.main.async {
                switch s.authorizationStatus {
                case .authorized, .provisional, .ephemeral: UIApplication.shared.registerForRemoteNotifications()
                case .denied: if type == "push:enable" { self.send?(["type": "push:denied"]) }
                case .notDetermined:
                    guard type == "push:enable" else { return }
                    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
                        DispatchQueue.main.async { if ok { UIApplication.shared.registerForRemoteNotifications() } else { self.send?(["type": "push:denied"]) } }
                    }
                @unknown default: break
                }
            }
        }
    }

    func registered(_ token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let sandbox = true   // development builds talk to Apple's sandbox push service
        #else
        let sandbox = false
        #endif
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        send?(["type": "push:token", "platform": "ios", "token": hex, "sandbox": sandbox, "version": version])
    }
    func failed() { send?(["type": "push:unavailable"]) }

    /// Page ready: open anything a tap queued before the web view existed.
    func flush() { if let p = pendingOpen { pendingOpen = nil; open?(p) } }

    // Shown even while SEND is open (the server only pushes when you aren't active, so this is rare).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound, .list])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        if let url = response.notification.request.content.userInfo["url"] as? String, url.hasPrefix("/"), !url.hasPrefix("//") {
            if let open { open(url) } else { pendingOpen = url }
        }
        done()
    }
}
