import SwiftUI

struct AboutView: View {
    @Binding var languageMode: AppLanguageMode

    var body: some View {
        List {
            Section(languageMode.text(thai: "ภาษา", english: "Language")) {
                Picker(
                    languageMode.text(thai: "ภาษาของแอป", english: "App language"),
                    selection: $languageMode
                ) {
                    ForEach(AppLanguageMode.allCases) { mode in
                        Text(mode.pickerLabel).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                Text(languageMode.text(
                    thai: "แนะนำแบบสองภาษา ระบบจะจำการตั้งค่าบนอุปกรณ์นี้",
                    english: "Bilingual is recommended. This choice is remembered on this device."
                ))
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Section {
                VStack(spacing: 16) {
                    Image("LaunchLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 128, height: 128)
                        .accessibilityLabel(languageMode.text(
                            thai: "ตราสัญลักษณ์ TOPMANIDMB",
                            english: "TOPMANIDMB emblem"
                        ))

                    Text("TOPMANIDMB World Monitor")
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)

                    Text(languageMode.text(
                        thai: "ศูนย์ติดตามข่าว สงคราม เศรษฐกิจ ภัยพิบัติ เที่ยวบิน และตลาดการเงินทั่วโลก",
                        english: "Global news, conflict, economy, disaster, aviation, and financial market monitoring."
                    ))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical)
            }

            Section(languageMode.text(thai: "แหล่งที่มา", english: "Source")) {
                Text(languageMode.text(
                    thai: "แอปนี้เป็น TOPMANIDMB branded client ที่พัฒนาต่อยอดจากโครงการโอเพนซอร์ส World Monitor",
                    english: "This TOPMANIDMB branded client is built on the open-source World Monitor project."
                ))
                Link(languageMode.text(thai: "World Monitor บน GitHub", english: "World Monitor on GitHub"), destination: URL(string: "https://github.com/koala73/worldmonitor")!)
                Link("TOPMANIDMB Repository", destination: URL(string: "https://github.com/Topman3579/topmanidmb-world-monitor")!)
            }

            Section(languageMode.text(thai: "ความเป็นส่วนตัว", english: "Privacy")) {
                Label(
                    languageMode.text(
                        thai: "ไม่ขอสิทธิ์ตำแหน่ง กล้อง ไมโครโฟน หรือรายชื่อผู้ติดต่อ",
                        english: "No location, camera, microphone, or contacts permissions"
                    ),
                    systemImage: "hand.raised.fill"
                )
                Label(
                    languageMode.text(
                        thai: "ไม่มีข้อมูลคดีหรือข้อมูลส่วนบุคคลฝังในแอป",
                        english: "No case data or personal information is embedded"
                    ),
                    systemImage: "lock.shield.fill"
                )
            }

            Section {
                LabeledContent(languageMode.text(thai: "เวอร์ชัน", english: "Version"), value: appVersion)
                LabeledContent("Build", value: buildNumber)
            }
        }
        .navigationTitle(languageMode.text(thai: "เกี่ยวกับ", english: "About"))
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }
}
