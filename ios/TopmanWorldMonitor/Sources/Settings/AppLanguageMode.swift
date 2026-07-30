import Foundation

enum AppLanguageMode: String, CaseIterable, Identifiable {
    case thai = "th"
    case bilingual
    case english = "en"

    var id: String { rawValue }

    var pickerLabel: String {
        switch self {
        case .thai: "ไทย"
        case .bilingual: "ไทย + English"
        case .english: "English"
        }
    }

    var webLanguage: String {
        self == .english ? "en" : "th"
    }

    func text(thai: String, english: String) -> String {
        switch self {
        case .thai:
            thai
        case .bilingual:
            "\(thai) / \(english)"
        case .english:
            english
        }
    }

    var dashboardURL: URL {
        var components = URLComponents(
            string: "https://topmanidmb-world-monitor.vercel.app/dashboard"
        )!
        components.queryItems = [
            URLQueryItem(name: "lang", value: webLanguage),
            URLQueryItem(name: "topmanMode", value: rawValue),
        ]
        return components.url!
    }
}
