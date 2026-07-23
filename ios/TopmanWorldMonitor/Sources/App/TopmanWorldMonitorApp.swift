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

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                NavigationStack {
                    MonitorView()
                }
                .tabItem { Label("สถานการณ์", systemImage: "globe.asia.australia.fill") }
                .tag(RootTab.monitor)

                NavigationStack {
                    HealthStatusView()
                }
                .tabItem { Label("สถานะระบบ", systemImage: "waveform.path.ecg") }
                .tag(RootTab.health)

                NavigationStack {
                    AboutView()
                }
                .tabItem { Label("เกี่ยวกับ", systemImage: "shield.lefthalf.filled") }
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

