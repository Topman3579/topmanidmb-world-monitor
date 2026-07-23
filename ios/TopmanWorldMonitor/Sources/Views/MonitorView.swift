import SwiftUI

struct MonitorView: View {
    @EnvironmentObject private var network: NetworkMonitor
    @StateObject private var browser = BrowserController()

    var body: some View {
        ZStack(alignment: .top) {
            Color("LaunchBackground").ignoresSafeArea()
            WorldMonitorWebView(controller: browser)

            if !network.isOnline {
                OfflineBanner()
                    .padding(.top, 8)
            }

            if let error = browser.errorMessage {
                ContentUnavailableView {
                    Label("เปิดศูนย์สถานการณ์ไม่ได้", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("ลองใหม่") { browser.loadDashboard() }
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
                .accessibilityLabel("ย้อนกลับ")

                Button {
                    browser.goForward()
                } label: {
                    Image(systemName: "chevron.forward")
                }
                .disabled(!browser.canGoForward)
                .accessibilityLabel("ไปข้างหน้า")
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
                .accessibilityLabel("โหลดข้อมูลใหม่")

                ShareLink(item: BrowserController.dashboardURL) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("แชร์ศูนย์สถานการณ์")
            }
        }
    }
}

private struct OfflineBanner: View {
    var body: some View {
        Label("ออฟไลน์ — กำลังแสดงข้อมูลที่มีในเครื่อง", systemImage: "wifi.slash")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.thinMaterial, in: Capsule())
            .accessibilityIdentifier("offline-banner")
    }
}
