import Combine
import Foundation

struct HealthSummary: Codable, Equatable {
    let total: Int
    let ok: Int
    let warn: Int
    let onDemandWarn: Int
    let staleContent: Int
    let crit: Int
}

struct HealthPayload: Codable, Equatable {
    let status: String
    let summary: HealthSummary
}

enum HealthState: Equatable {
    case loading
    case available(HealthPayload, Date)
    case failed(String)
}

@MainActor
final class HealthMonitor: ObservableObject {
    static let endpoint = URL(
        string: "https://topmanidmb-world-monitor.vercel.app/api/health?compact=1"
    )!

    @Published private(set) var state: HealthState = .loading
    private var pollingStarted = false

    func refresh(session: URLSession = .shared) async {
        do {
            var request = URLRequest(url: Self.endpoint)
            request.timeoutInterval = 15
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let payload = try JSONDecoder().decode(HealthPayload.self, from: data)
            state = .available(payload, Date())
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func startPolling() async {
        guard !pollingStarted else { return }
        pollingStarted = true
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }
}

