import SwiftUI

enum RootTab: Hashable {
    case monitor
    case health
    case about
}

@main
struct TopmanWorldMonitorApp: App {
    @StateObject private var network = NetworkMonitor()
    @StateObject private var health = HealthMonitor()
    @State private var selectedTab: RootTab = .monitor
    @AppStorage("topman-language-mode") private var languageMode: AppLanguageMode = .bilingual

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                NavigationStack {
                    MonitorView(languageMode: languageMode)
                }
                .tabItem {
                    Label(
                        languageMode.text(thai: "สถานการณ์", english: "Monitor"),
                        systemImage: "globe.asia.australia.fill"
                    )
                }
                .tag(RootTab.monitor)

                NavigationStack {
                    HealthStatusView(languageMode: languageMode)
                }
                .tabItem {
                    Label(
                        languageMode.text(thai: "สถานะระบบ", english: "Health"),
                        systemImage: "waveform.path.ecg"
                    )
                }
                .tag(RootTab.health)

                NavigationStack {
                    AboutView(languageMode: $languageMode)
                }
                .tabItem {
                    Label(
                        languageMode.text(thai: "เกี่ยวกับ", english: "About"),
                        systemImage: "shield.lefthalf.filled"
                    )
                }
                .tag(RootTab.about)
            }
            .environmentObject(network)
            .environmentObject(health)
            .preferredColorScheme(.dark)
            .tint(Color("AccentColor"))
            .task {
                await health.refresh()
                await health.startPolling()
            }
        }
    }
}
