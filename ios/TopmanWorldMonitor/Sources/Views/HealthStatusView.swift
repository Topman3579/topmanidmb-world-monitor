import SwiftUI

struct HealthStatusView: View {
    @EnvironmentObject private var health: HealthMonitor
    @EnvironmentObject private var network: NetworkMonitor
    let languageMode: AppLanguageMode

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: network.isOnline ? "network" : "wifi.slash")
                        .font(.title2)
                        .foregroundStyle(network.isOnline ? .green : .orange)
                    VStack(alignment: .leading) {
                        Text(network.isOnline
                             ? languageMode.text(thai: "เชื่อมต่อเครือข่าย", english: "Connected")
                             : languageMode.text(thai: "ออฟไลน์", english: "Offline"))
                            .font(.headline)
                        Text(languageMode.text(
                            thai: "ตรวจจากอุปกรณ์เครื่องนี้",
                            english: "Checked from this device"
                        ))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            switch health.state {
            case .loading:
                Section {
                    HStack {
                        ProgressView()
                        Text(languageMode.text(thai: "กำลังตรวจสถานะระบบ…", english: "Checking system health…"))
                    }
                }

            case let .failed(message):
                Section("Health API") {
                    Label(
                        languageMode.text(thai: "ตรวจสอบไม่สำเร็จ", english: "Health check failed"),
                        systemImage: "exclamationmark.triangle.fill"
                    )
                        .foregroundStyle(.orange)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

            case let .available(payload, checkedAt):
                Section(languageMode.text(thai: "สถานะศูนย์ข้อมูล", english: "Data center health")) {
                    HStack {
                        Label(payload.status, systemImage: statusSymbol(payload.status))
                            .foregroundStyle(statusColor(payload.status))
                        Spacer()
                        Text(checkedAt, style: .time)
                            .foregroundStyle(.secondary)
                    }
                }

                Section(languageMode.text(
                    thai: "แหล่งข้อมูล \(payload.summary.total) ชุด",
                    english: "\(payload.summary.total) data sources"
                )) {
                    MetricRow(label: languageMode.text(thai: "พร้อมใช้งาน", english: "Available"), value: payload.summary.ok, color: .green)
                    MetricRow(label: languageMode.text(thai: "คำเตือน", english: "Warning"), value: payload.summary.warn, color: .yellow)
                    MetricRow(label: languageMode.text(thai: "ตรวจเมื่อเรียกใช้", english: "On demand"), value: payload.summary.onDemandWarn, color: .blue)
                    MetricRow(label: languageMode.text(thai: "ข้อมูลเก่า", english: "Stale"), value: payload.summary.staleContent, color: .orange)
                    MetricRow(label: languageMode.text(thai: "วิกฤต/ไม่มีข้อมูล", english: "Critical / missing"), value: payload.summary.crit, color: .red)
                }
            }

            Section {
                Button {
                    Task { await health.refresh() }
                } label: {
                    Label(
                        languageMode.text(thai: "ตรวจใหม่ตอนนี้", english: "Check again"),
                        systemImage: "arrow.clockwise"
                    )
                }
                .disabled(!network.isOnline)

                Link(destination: HealthMonitor.endpoint) {
                    Label(
                        languageMode.text(thai: "เปิด Health API", english: "Open Health API"),
                        systemImage: "safari"
                    )
                }
            } footer: {
                Text(languageMode.text(
                    thai: "HTTP 200 หมายถึงปลายทางตอบสนอง ไม่ได้หมายความว่าแหล่งข้อมูลทุกชุดพร้อมใช้งาน",
                    english: "HTTP 200 confirms the endpoint responded; it does not mean every data source is ready."
                ))
            }
        }
        .navigationTitle(languageMode.text(thai: "สถานะระบบ", english: "System health"))
        .refreshable {
            await health.refresh()
        }
    }

    private func statusSymbol(_ status: String) -> String {
        status == "HEALTHY" ? "checkmark.seal.fill" : "exclamationmark.shield.fill"
    }

    private func statusColor(_ status: String) -> Color {
        status == "HEALTHY" ? .green : .red
    }
}

private struct MetricRow: View {
    let label: String
    let value: Int
    let color: Color

    var body: some View {
        HStack {
            Circle()
                .fill(color)
                .frame(width: 9, height: 9)
            Text(label)
            Spacer()
            Text(value.formatted())
                .font(.body.monospacedDigit().weight(.semibold))
        }
    }
}
