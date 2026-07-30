import SwiftUI

struct MonitorView: View {
    @EnvironmentObject private var network: NetworkMonitor
    @StateObject private var browser = BrowserController()
    let languageMode: AppLanguageMode

    var body: some View {
        ZStack(alignment: .top) {
            Color("LaunchBackground").ignoresSafeArea()
            WorldMonitorWebView(controller: browser, languageMode: languageMode)

            if !network.isOnline {
                OfflineBanner(languageMode: languageMode)
                    .padding(.top, 8)
            }

            if let error = browser.errorMessage {
                ContentUnavailableView {
                    Label(
                        languageMode.text(
                            thai: "เปิดศูนย์สถานการณ์ไม่ได้",
                            english: "Unable to open the monitor"
                        ),
                        systemImage: "wifi.exclamationmark"
                    )
                } description: {
                    Text(error)
                } actions: {
                    Button(languageMode.text(thai: "ลองใหม่", english: "Try again")) {
                        browser.loadDashboard(languageMode: languageMode)
                    }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
                .background(.ultraThinMaterial)
            }
        }
        .navigationTitle("TOPMANIDMB")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color("LaunchBackground"), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarLeading) {
                Button {
                    browser.goBack()
                } label: {
                    Image(systemName: "chevron.backward")
                }
                .disabled(!browser.canGoBack)
                .accessibilityLabel(languageMode.text(thai: "ย้อนกลับ", english: "Back"))

                Button {
                    browser.goForward()
                } label: {
                    Image(systemName: "chevron.forward")
                }
                .disabled(!browser.canGoForward)
                .accessibilityLabel(languageMode.text(thai: "ไปข้างหน้า", english: "Forward"))
            }

            ToolbarItemGroup(placement: .topBarTrailing) {
                if browser.isLoading {
                    ProgressView()
                }

                Button {
                    browser.reload()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel(languageMode.text(thai: "โหลดข้อมูลใหม่", english: "Reload"))

                ShareLink(item: languageMode.dashboardURL) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel(languageMode.text(thai: "แชร์ศูนย์สถานการณ์", english: "Share monitor"))
            }
        }
        .onChange(of: languageMode) { _, newMode in
            browser.loadDashboard(languageMode: newMode)
        }
    }
}

private struct OfflineBanner: View {
    let languageMode: AppLanguageMode

    var body: some View {
        Label(
            languageMode.text(
                thai: "ออฟไลน์ — กำลังแสดงข้อมูลที่มีในเครื่อง",
                english: "Offline — showing cached data"
            ),
            systemImage: "wifi.slash"
        )
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.thinMaterial, in: Capsule())
            .accessibilityIdentifier("offline-banner")
    }
}
