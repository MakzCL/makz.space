import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: session.role)
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var web: WebViewController? { window?.rootViewController as? WebViewController }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.backgroundColor = WebViewController.background
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        if let url = options.userActivities.first?.webpageURL ?? options.urlContexts.first?.url { web?.open(url) }
    }
    // Universal links (https://syndo.makz.space/...) open inside the app.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) { if let url = userActivity.webpageURL { web?.open(url) } }
    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) { if let url = contexts.first?.url { web?.open(url) } }
}
