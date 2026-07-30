import XCTest
@testable import TopmanWorldMonitor

final class HealthPayloadTests: XCTestCase {
    func testDecodesCompactHealthPayload() throws {
        let data = Data("""
        {
          "status": "UNHEALTHY",
          "checkedAt": "2026-07-30T01:45:12.345Z",
          "summary": {
            "total": 6,
            "ok": 3,
            "warn": 2,
            "onDemandWarn": 0,
            "staleContent": 0,
            "crit": 1
          }
        }
        """.utf8)

        let payload = try JSONDecoder().decode(HealthPayload.self, from: data)
        XCTAssertEqual(payload.status, "UNHEALTHY")
        XCTAssertEqual(payload.summary.total, 6)
        XCTAssertEqual(payload.summary.crit, 1)
        XCTAssertNil(HealthMonitor.validationFailure(
            for: payload,
            now: payload.checkedAt.addingTimeInterval(60)
        ))
    }

    func testRejectsMissingOrMalformedServerTimestamp() throws {
        let missingTimestamp = Data("""
        {
          "status": "HEALTHY",
          "summary": {
            "total": 6,
            "ok": 6,
            "warn": 0,
            "onDemandWarn": 0,
            "staleContent": 0,
            "crit": 0
          }
        }
        """.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(HealthPayload.self, from: missingTimestamp))

        let malformedTimestamp = Data("""
        {
          "status": "HEALTHY",
          "checkedAt": "not-a-timestamp",
          "summary": {
            "total": 6,
            "ok": 6,
            "warn": 0,
            "onDemandWarn": 0,
            "staleContent": 0,
            "crit": 0
          }
        }
        """.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(HealthPayload.self, from: malformedTimestamp))
    }

    func testFailsClosedForStaleOrFutureHealthSnapshots() throws {
        let data = Data("""
        {
          "status": "HEALTHY",
          "checkedAt": "2026-07-30T01:45:12Z",
          "summary": {
            "total": 6,
            "ok": 6,
            "warn": 0,
            "onDemandWarn": 0,
            "staleContent": 0,
            "crit": 0
          }
        }
        """.utf8)
        let payload = try JSONDecoder().decode(HealthPayload.self, from: data)

        XCTAssertEqual(
            HealthMonitor.validationFailure(
                for: payload,
                now: payload.checkedAt.addingTimeInterval(HealthMonitor.maximumSnapshotAge + 1)
            ),
            .staleResponse
        )
        XCTAssertEqual(
            HealthMonitor.validationFailure(
                for: payload,
                now: payload.checkedAt.addingTimeInterval(-(HealthMonitor.maximumFutureSkew + 1))
            ),
            .invalidResponse
        )
    }

    func testFailsClosedForContradictoryOrIncoherentSummary() throws {
        let contradictory = Data("""
        {
          "status": "HEALTHY",
          "checkedAt": "2026-07-30T01:45:12Z",
          "summary": {
            "total": 6,
            "ok": 5,
            "warn": 1,
            "onDemandWarn": 0,
            "staleContent": 0,
            "crit": 0
          }
        }
        """.utf8)
        let contradictoryPayload = try JSONDecoder().decode(HealthPayload.self, from: contradictory)
        XCTAssertEqual(
            HealthMonitor.validationFailure(
                for: contradictoryPayload,
                now: contradictoryPayload.checkedAt
            ),
            .invalidResponse
        )

        let incoherent = Data("""
        {
          "status": "WARNING",
          "checkedAt": "2026-07-30T01:45:12Z",
          "summary": {
            "total": 6,
            "ok": 4,
            "warn": 1,
            "onDemandWarn": 0,
            "staleContent": 2,
            "crit": 0
          }
        }
        """.utf8)
        let incoherentPayload = try JSONDecoder().decode(HealthPayload.self, from: incoherent)
        XCTAssertEqual(
            HealthMonitor.validationFailure(
                for: incoherentPayload,
                now: incoherentPayload.checkedAt
            ),
            .invalidResponse
        )

        let negativeCounts = Data("""
        {
          "status": "WARNING",
          "checkedAt": "2026-07-30T01:45:12Z",
          "summary": {
            "total": 6,
            "ok": 7,
            "warn": 1,
            "onDemandWarn": -2,
            "staleContent": -1,
            "crit": 0
          }
        }
        """.utf8)
        let negativePayload = try JSONDecoder().decode(HealthPayload.self, from: negativeCounts)
        XCTAssertEqual(
            HealthMonitor.validationFailure(
                for: negativePayload,
                now: negativePayload.checkedAt
            ),
            .invalidResponse
        )
    }

    func testLanguageModeTextAndDashboardURL() throws {
        XCTAssertEqual(
            HealthMonitor.endpoint.absoluteString,
            "https://topmanidmb-world-monitor.vercel.app/api/topman-core-status"
        )
        XCTAssertEqual(
            HealthMonitor.globalEndpoint.absoluteString,
            "https://topmanidmb-world-monitor.vercel.app/api/health?compact=1"
        )

        XCTAssertEqual(
            AppLanguageMode.bilingual.text(thai: "สถานะ", english: "Health"),
            "สถานะ / Health"
        )
        XCTAssertEqual(
            AppLanguageMode.english.text(thai: "สถานะ", english: "Health"),
            "Health"
        )

        let components = try XCTUnwrap(
            URLComponents(url: AppLanguageMode.bilingual.dashboardURL, resolvingAgainstBaseURL: false)
        )
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map {
            ($0.name, $0.value ?? "")
        })
        XCTAssertEqual(query["lang"], "th")
        XCTAssertEqual(query["topmanMode"], "bilingual")
    }
}
