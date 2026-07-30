import Combine
import Foundation

struct HealthSummary: Decodable, Equatable, Sendable {
    let total: Int
    let ok: Int
    let warn: Int
    let onDemandWarn: Int
    let staleContent: Int
    let crit: Int
}

struct HealthPayload: Decodable, Equatable, Sendable {
    let status: String
    let checkedAt: Date
    let summary: HealthSummary

    private enum CodingKeys: String, CodingKey {
        case status
        case checkedAt
        case summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(String.self, forKey: .status)
        summary = try container.decode(HealthSummary.self, forKey: .summary)

        let rawTimestamp = try container.decode(String.self, forKey: .checkedAt)
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standardFormatter = ISO8601DateFormatter()
        standardFormatter.formatOptions = [.withInternetDateTime]
        guard let parsedTimestamp = fractionalFormatter.date(from: rawTimestamp)
                ?? standardFormatter.date(from: rawTimestamp) else {
            throw DecodingError.dataCorruptedError(
                forKey: .checkedAt,
                in: container,
                debugDescription: "checkedAt must be an ISO-8601 timestamp"
            )
        }
        checkedAt = parsedTimestamp
    }
}

enum HealthFailure: Equatable, Sendable {
    case serviceUnavailable
    case invalidResponse
    case staleResponse
}

enum HealthState: Equatable {
    case loading
    case available(HealthPayload)
    case failed(HealthFailure)
}

@MainActor
final class HealthMonitor: ObservableObject {
    nonisolated static let endpoint = URL(
        string: "https://topmanidmb-world-monitor.vercel.app/api/topman-core-status"
    )!
    nonisolated static let globalEndpoint = URL(
        string: "https://topmanidmb-world-monitor.vercel.app/api/health?compact=1"
    )!

    @Published private(set) var state: HealthState = .loading
    private var pollingStarted = false
    nonisolated static let maximumSnapshotAge: TimeInterval = 5 * 60
    nonisolated static let maximumFutureSkew: TimeInterval = 60

    nonisolated static func validationFailure(
        for payload: HealthPayload,
        now: Date = Date()
    ) -> HealthFailure? {
        let summary = payload.summary
        let countsAreNonnegative = [
            summary.total,
            summary.ok,
            summary.warn,
            summary.onDemandWarn,
            summary.staleContent,
            summary.crit,
        ].allSatisfy { $0 >= 0 }
        let countsAreCoherent =
            summary.ok + summary.warn + summary.onDemandWarn + summary.crit == summary.total
            && summary.staleContent <= summary.warn
        let statusIsCoherent: Bool
        switch payload.status {
        case "HEALTHY":
            statusIsCoherent =
                summary.ok == summary.total
                && summary.warn == 0
                && summary.onDemandWarn == 0
                && summary.staleContent == 0
                && summary.crit == 0
        case "WARNING":
            statusIsCoherent = summary.warn > 0 && summary.crit == 0
        case "UNHEALTHY":
            statusIsCoherent = summary.crit > 0
        default:
            statusIsCoherent = false
        }

        guard summary.total == 6,
              countsAreNonnegative,
              countsAreCoherent,
              statusIsCoherent,
              payload.checkedAt <= now.addingTimeInterval(maximumFutureSkew) else {
            return .invalidResponse
        }
        if now.timeIntervalSince(payload.checkedAt) > maximumSnapshotAge {
            return .staleResponse
        }
        return nil
    }

    func refresh(session: URLSession = .shared, now: Date = Date()) async {
        do {
            var request = URLRequest(url: Self.endpoint)
            request.timeoutInterval = 10
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                state = .failed(.serviceUnavailable)
                return
            }
            let payload: HealthPayload
            do {
                payload = try JSONDecoder().decode(HealthPayload.self, from: data)
            } catch {
                state = .failed(.invalidResponse)
                return
            }
            if let failure = Self.validationFailure(for: payload, now: now) {
                state = .failed(failure)
                return
            }
            state = .available(payload)
        } catch {
            state = .failed(.serviceUnavailable)
        }
    }

    func startPolling() async {
        guard !pollingStarted else { return }
        pollingStarted = true
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(300))
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }
}
