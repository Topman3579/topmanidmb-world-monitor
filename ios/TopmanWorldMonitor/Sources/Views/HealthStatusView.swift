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
                        Text(languageMode.text(
                            thai: "กำลังตรวจข้อมูลหลัก TOPMAN 6 ชุด…",
                            english: "Checking six TOPMAN core data lanes…"
                        ))
                    }
                }

            case let .failed(failure):
                Section(languageMode.text(
                    thai: "ระบบตรวจสถานะ",
                    english: "Health service"
                )) {
                    Label(
                        languageMode.text(thai: "ตรวจสอบไม่สำเร็จ", english: "Health check failed"),
                        systemImage: "exclamationmark.triangle.fill"
                    )
                        .foregroundStyle(.orange)
                    Text(failureMessage(failure))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

            case let .available(payload):
                Section(languageMode.text(
                    thai: "สถานะข้อมูลหลัก TOPMAN",
                    english: "TOPMAN core data health"
                )) {
                    HStack {
                        Label(statusText(payload.status), systemImage: statusSymbol(payload.status))
                            .foregroundStyle(statusColor(payload.status))
                        Spacer()
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(payload.checkedAt, style: .time)
                            Text(languageMode.text(
                                thai: "เวลาจากเซิร์ฟเวอร์",
                                english: "Server time"
                            ))
                                .font(.caption2)
                        }
                        .foregroundStyle(.secondary)
                    }
                }

                Section(languageMode.text(
                    thai: "ชุดข้อมูลหลัก \(payload.summary.total) ชุด",
                    english: "\(payload.summary.total) core datasets"
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
                        languageMode.text(
                            thai: "เปิดผลตรวจข้อมูลหลัก 6 ชุด",
                            english: "Open Core 6 health"
                        ),
                        systemImage: "safari"
                    )
                }

                Link(destination: HealthMonitor.globalEndpoint) {
                    Label(
                        languageMode.text(
                            thai: "เปิดผลตรวจระบบต้นทางทั้งหมด",
                            english: "Open full upstream health"
                        ),
                        systemImage: "safari"
                    )
                }
            } footer: {
                Text(languageMode.text(
                    thai: "หน้านี้สรุปเฉพาะข้อมูลหลัก TOPMAN 6 ชุด ไม่ใช่สถานะของระบบ World Monitor ทั้งหมด",
                    english: "This page reports only six TOPMAN core lanes, not the health of the full World Monitor system."
                ))
            }
        }
        .navigationTitle(languageMode.text(thai: "สถานะข้อมูล", english: "Data health"))
        .refreshable {
            await health.refresh()
        }
    }

    private func statusSymbol(_ status: String) -> String {
        switch status {
        case "HEALTHY":
            return "checkmark.seal.fill"
        case "WARNING":
            return "exclamationmark.triangle.fill"
        default:
            return "exclamationmark.shield.fill"
        }
    }

    private func statusText(_ status: String) -> String {
        switch status {
        case "HEALTHY":
            return languageMode.text(thai: "พร้อมใช้งาน", english: "Healthy")
        case "WARNING":
            return languageMode.text(thai: "มีคำเตือน", english: "Warning")
        case "UNHEALTHY":
            return languageMode.text(thai: "ยังไม่พร้อม", english: "Unhealthy")
        default:
            return languageMode.text(thai: "ไม่ทราบสถานะ", english: "Unknown")
        }
    }

    private func failureMessage(_ failure: HealthFailure) -> String {
        switch failure {
        case .serviceUnavailable:
            return languageMode.text(
                thai: "ยังติดต่อระบบตรวจสถานะไม่ได้ โปรดลองใหม่",
                english: "The health service is unavailable. Please try again."
            )
        case .invalidResponse:
            return languageMode.text(
                thai: "ผลตรวจจากเซิร์ฟเวอร์ไม่สมบูรณ์ จึงยังไม่แสดงว่าใช้งานได้",
                english: "The server response is incomplete, so availability cannot be confirmed."
            )
        case .staleResponse:
            return languageMode.text(
                thai: "ผลตรวจจากเซิร์ฟเวอร์เก่าเกิน 5 นาที จึงยังไม่ยืนยันสถานะ",
                english: "The server snapshot is over 5 minutes old, so health is not confirmed."
            )
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "HEALTHY":
            return .green
        case "WARNING":
            return .orange
        default:
            return .red
        }
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
