// AlbaDeviceActivityReport.swift
// DeviceActivityReportExtension — invoked by the system when the main app renders
// a DeviceActivityReport SwiftUI view. Reads per-app usage via DeviceActivityResults
// and writes totals to the shared App Group UserDefaults so the RN layer can read them.
//
// ── How it connects to the rest of the app ────────────────────────────────────
// 1. Main app (AlbaReportViewController) presents a hidden DeviceActivityReport view
//    tagged with context "alba.report".
// 2. The OS launches this extension and calls makeConfiguration(representing:) with
//    live usage data. This is the correct DeviceActivityReportScene API (iOS 16+).
// 3. makeConfiguration writes JSON to shared UserDefaults and returns AlbaReportConfig.
// 4. The content closure renders an invisible AlbaReportView.
// 5. AlbaReportViewController's completion block fires after a 2-second delay, then
//    AlbaScreenTimeModule.refreshReport() resolves with the freshly written JSON.
//
// ── DeviceActivityReportScene protocol (iOS 16+) ─────────────────────────────
// Required:
//   let context: DeviceActivityReport.Context
//   let content: (Configuration) -> Content   (closure property)
//   func makeConfiguration(representing: DeviceActivityResults<DeviceActivityData>)
//         async -> Configuration
// ─────────────────────────────────────────────────────────────────────────────

import DeviceActivity
import SwiftUI

private let kAppGroup      = "group.com.alba.app.screentime"
private let kUsageKey      = "alba_usage_data"
private let kReportContext = DeviceActivityReport.Context(rawValue: "alba.report")

// MARK: - Configuration type passed from scene to view

struct AlbaReportConfig {
  let totalMinutes: Int
  let appsData: [String: Any]
  let appCount: Int
  let deviceCount: Int
  let segmentCount: Int
  let categoryCount: Int
}

// MARK: - Extension entry point

@main
struct AlbaDeviceActivityReportExtension: DeviceActivityReportExtension {
  var body: some DeviceActivityReportScene {
    AlbaReportScene { config in
      AlbaReportView(config: config)
    }
  }
}

// MARK: - Report scene

struct AlbaReportScene: DeviceActivityReportScene {
  let context: DeviceActivityReport.Context = kReportContext
  let content: (AlbaReportConfig) -> AlbaReportView

  /// Called by the system with live DeviceActivity data.
  /// Extracts per-app usage, writes to shared UserDefaults, and returns a config
  /// that the content closure uses to render the (invisible) view.
  func makeConfiguration(
    representing data: DeviceActivityResults<DeviceActivityData>
  ) async -> AlbaReportConfig {
    var totalSeconds: TimeInterval = 0
    var appsData: [String: Any] = [:]
    var appIndex = 0
    var deviceCount = 0
    var segmentCount = 0
    var categoryCount = 0

    for await deviceData in data {
      deviceCount += 1
      for await segment in deviceData.activitySegments {
        segmentCount += 1
        for await category in segment.categories {
          categoryCount += 1
          for await app in category.applications {
            let seconds = app.totalActivityDuration
            totalSeconds += seconds
            let minutes = Int(seconds / 60)
            let name = app.application.localizedDisplayName ?? "App\(appIndex + 1)"
            appsData[name] = ["minutes": minutes]
            appIndex += 1
          }
        }
      }
    }

    let totalMinutes = Int(totalSeconds / 60)
    let config = AlbaReportConfig(
      totalMinutes: totalMinutes,
      appsData: appsData,
      appCount: appIndex,
      deviceCount: deviceCount,
      segmentCount: segmentCount,
      categoryCount: categoryCount
    )
    writeToDefaults(config)
    return config
  }

  // MARK: - UserDefaults persistence

  private func writeToDefaults(_ config: AlbaReportConfig) {
    guard let defaults = UserDefaults(suiteName: kAppGroup) else { return }

    var usage: [String: Any] = loadExisting(defaults)

    let dayKey = weekdayKey()
    usage["lastUpdated"] = ISO8601DateFormatter().string(from: Date())
    usage["today"] = ["totalMinutes": config.totalMinutes, "apps": config.appsData]
    usage["_debug"] = [
      "ext_deviceCount": config.deviceCount,
      "ext_segmentCount": config.segmentCount,
      "ext_categoryCount": config.categoryCount,
      "ext_appCount": config.appCount,
    ]

    // Update daily totals and recompute week total
    var dailyTotals = usage["dailyTotals"] as? [String: Int] ?? emptyDailyTotals()
    dailyTotals[dayKey] = config.totalMinutes
    usage["dailyTotals"] = dailyTotals

    let weekTotal = dailyTotals.values.reduce(0, +)

    // Carry forward per-app weekly maxima
    var thisWeekApps = (usage["thisWeek"] as? [String: Any])?["apps"] as? [String: Any] ?? [:]
    for (name, value) in config.appsData {
      let todayMin = (value as? [String: Any])?["minutes"] as? Int ?? 0
      let prevMin  = (thisWeekApps[name] as? [String: Any])?["minutes"] as? Int ?? 0
      thisWeekApps[name] = ["minutes": max(prevMin, todayMin)]
    }
    usage["thisWeek"] = ["totalMinutes": weekTotal, "apps": thisWeekApps]

    guard
      let data = try? JSONSerialization.data(withJSONObject: usage),
      let str  = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(str, forKey: kUsageKey)
    // Write a separate key so AlbaReportViewController can distinguish
    // a report-extension write from a monitor-extension write.
    defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: "alba_report_token")
  }

  private func loadExisting(_ defaults: UserDefaults) -> [String: Any] {
    guard
      let json = defaults.string(forKey: kUsageKey),
      let data = json.data(using: .utf8),
      let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    return obj
  }

  private func weekdayKey() -> String {
    let keys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return keys[Calendar.current.component(.weekday, from: Date()) - 1]
  }

  private func emptyDailyTotals() -> [String: Int] {
    ["Mon": 0, "Tue": 0, "Wed": 0, "Thu": 0, "Fri": 0, "Sat": 0, "Sun": 0]
  }
}

// MARK: - Report view (invisible — exists only to satisfy the content closure)

struct AlbaReportView: View {
  let config: AlbaReportConfig

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
  }
}
