import SwiftUI

struct AboutView: View {
    var body: some View {
        List {
            Section {
                VStack(spacing: 16) {
                    Image("LaunchLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 128, height: 128)
                        .accessibilityLabel("ตราสัญลักษณ์ TOPMANIDMB")

                    Text("TOPMANIDMB World Monitor")
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)

                    Text("ศูนย์ติดตามข่าว สงคราม เศรษฐกิจ ภัยพิบัติ เที่ยวบิน และตลาดการเงินทั่วโลก")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical)
            }

            Section("แหล่งที่มา") {
                Text("แอปนี้เป็น TOPMANIDMB branded client ที่พัฒนาต่อยอดจากโครงการโอเพนซอร์ส World Monitor")
                Link("World Monitor บน GitHub", destination: URL(string: "https://github.com/koala73/worldmonitor")!)
                Link("TOPMANIDMB Repository", destination: URL(string: "https://github.com/Topman3579/topmanidmb-world-monitor")!)
            }

            Section("ความเป็นส่วนตัว") {
                Label("ไม่ขอสิทธิ์ตำแหน่ง กล้อง ไมโครโฟน หรือรายชื่อผู้ติดต่อ", systemImage: "hand.raised.fill")
                Label("ไม่มีข้อมูลคดีหรือข้อมูลส่วนบุคคลฝังในแอป", systemImage: "lock.shield.fill")
            }

            Section {
                LabeledContent("เวอร์ชัน", value: appVersion)
                LabeledContent("Build", value: buildNumber)
            }
        }
        .navigationTitle("เกี่ยวกับ")
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }
}

