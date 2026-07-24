import XCTest
@testable import TopmanWorldMonitor

final class HealthPayloadTests: XCTestCase {
    func testDecodesCompactHealthPayload() throws {
        let data = Data("""
        {
          "status": "UNHEALTHY",
          "summary": {
            "total": 232,
            "ok": 3,
            "warn": 21,
            "onDemandWarn": 29,
            "staleContent": 0,
            "crit": 179
          }
        }
        """.utf8)

        let payload = try JSONDecoder().decode(HealthPayload.self, from: data)
        XCTAssertEqual(payload.status, "UNHEALTHY")
        XCTAssertEqual(payload.summary.total, 232)
        XCTAssertEqual(payload.summary.crit, 179)
    }

    func testLanguageModeTextAndDashboardURL() throws {
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
