import SwiftUI

struct HealthStatusView: View {
    @EnvironmentObject private var health: HealthMonitor
    @EnvironmentObject private var network: NetworkMonitor

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: network.isOnline ? "network" : "wifi.slash")
                        .font(.title2)
                        .foregroundStyle(network.isOnline ? .green : .orange)
                    VStack(alignment: .leading) {
                        Text(network.isOnline ? "เชื่อมต่อเครือข่าย" : "ออฟไลน์")
                            .font(.headline)
                        Text("ตรวจจากอุปกรณ์เครื่องนี้")
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
                        Text("กำลังตรวจสถานะระบบ…")
                    }
                }

            case let .failed(message):
                Section("Health API") {
                    Label("ตรวจสอบไม่สำเร็จ", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

            case let .available(payload, checkedAt):
                Section("สถานะศูนย์ข้อมูล") {
                    HStack {
                        Label(payload.status, systemImage: statusSymbol(payload.status))
                            .foregroundStyle(statusColor(payload.status))
                        Spacer()
                        Text(checkedAt, style: .time)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("แหล่งข้อมูล \(payload.summary.total) ชุด") {
                    MetricRow(label: "พร้อมใช้งาน", value: payload.summary.ok, color: .green)
                    MetricRow(label: "คำเตือน", value: payload.summary.warn, color: .yellow)
                    MetricRow(label: "ตรวจเมื่อเรียกใช้", value: payload.summary.onDemandWarn, color: .blue)
                    MetricRow(label: "ข้อมูลเก่า", value: payload.summary.staleContent, color: .orange)
                    MetricRow(label: "วิกฤต/ไม่มีข้อมูล", value: payload.summary.crit, color: .red)
                }
            }

            Section {
                Button {
                    Task { await health.refresh() }
                } label: {
                    Label("ตรวจใหม่ตอนนี้", systemImage: "arrow.clockwise")
                }
                .disabled(!network.isOnline)

                Link(destination: HealthMonitor.endpoint) {
                    Label("เปิด Health API", systemImage: "safari")
                }
            } footer: {
                Text("HTTP 200 หมายถึงปลายทางตอบสนอง ไม่ได้หมายความว่าแหล่งข้อมูลทุกชุดพร้อมใช้งาน")
            }
        }
        .navigationTitle("สถานะระบบ")
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

