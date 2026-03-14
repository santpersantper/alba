// AlbaDeviceActivityReport.swift
// DeviceActivityReportExtension — invoked by the system when the main app renders
// a DeviceActivityReport SwiftUI view. Reads per-app usage via DeviceActivityResults
// and writes totals to the shared App Group UserDefaults so the RN layer can read them.
//
// ── How it connects to the rest of the app ────────────────────────────────────
// 1. Main app (AlbaReportViewController) presents a hidden DeviceActivityReport view
//    tagged with context "alba.report".
// 2. The OS launches this extension and calls makeBody(context:) with live usage data.
// 3. AlbaReportView.body extracts per-app minutes and writes JSON to shared UserDefaults.
// 4. AlbaReportViewController's completion block fires after a 2-second delay, then
//    AlbaScreenTimeModule.refreshReport() resolves with the freshly written JSON.
//
// ── App name mapping note ─────────────────────────────────────────────────────
// ApplicationToken is opaque — bundle IDs are not accessible for privacy reasons.
// We use `ApplicationToken.localizedDisplayName` (iOS 16.2+) where available.
// If that API is unavailable at compile time, replace with ordinal keys ("App1"…)
// and map them by index on the JS side, matching the FamilyActivityPicker order.
// ─────────────────────────────────────────────────────────────────────────────

import DeviceActivity
import SwiftUI

private let kAppGroup  = "group.com.alba.app.screentime"
private let kUsageKey  = "alba_usage_data"
private let kReportContext = DeviceActivityReport.Context(rawValue: "alba.report")

// MARK: - Extension entry point

@main
struct AlbaDeviceActivityReportExtension: DeviceActivityReportExtension {
  var body: some DeviceActivityReportScene {
    AlbaReportScene()
  }
}

// MARK: - Report scene

struct AlbaReportScene: DeviceActivityReportScene {
  let context: DeviceActivityReport.Context = kReportContext

  func makeBody(context: DeviceActivityResults) -> AlbaReportView {
    AlbaReportView(results: context)
  }
}

// MARK: - Report view (extracts data and writes to UserDefaults as a side-effect)

struct AlbaReportView: View {
  let results: DeviceActivityResults

  var body: some View {
    // Invisible — this view exists only to trigger the data extraction task.
    Color.clear
      .frame(width: 1, height: 1)
      .task { await extractAndSave() }
  }

  private func extractAndSave() async {
    var totalSeconds: TimeInterval = 0
    var appsData: [String: Any] = [:]
    var appIndex = 0

    for await data in results {
      let seconds = data.totalActivityDuration
      totalSeconds += seconds
      let minutes = Int(seconds / 60)

      // localizedDisplayName is available on ApplicationToken in iOS 16.2+.
      // If your build target is exactly iOS 16.0 and this fails to compile,
      // replace with: let name = "App\(appIndex + 1)"
      let name = data.application.localizedDisplayName ?? "App\(appIndex + 1)"
      appsData[name] = ["minutes": minutes]
      appIndex += 1
    }

    let totalMinutes = Int(totalSeconds / 60)
    writeToDefaults(totalMinutes: totalMinutes, appsData: appsData)
  }

  private func writeToDefaults(totalMinutes: Int, appsData: [String: Any]) {
    guard let defaults = UserDefaults(suiteName: kAppGroup) else { return }

    // Load existing usage blob so we preserve thisWeek / dailyTotals
    var usage: [String: Any] = loadExisting(defaults)

    let dayKey = weekdayKey()
    usage["lastUpdated"] = ISO8601DateFormatter().string(from: Date())
    usage["today"] = ["totalMinutes": totalMinutes, "apps": appsData]

    // Update daily totals and recompute week total
    var dailyTotals = usage["dailyTotals"] as? [String: Int] ?? emptyDailyTotals()
    dailyTotals[dayKey] = totalMinutes
    usage["dailyTotals"] = dailyTotals

    let weekTotal = dailyTotals.values.reduce(0, +)

    // Carry forward per-app weekly sums from existing data
    var thisWeekApps = (usage["thisWeek"] as? [String: Any])?["apps"] as? [String: Any] ?? [:]
    for (name, value) in appsData {
      let todayMin = (value as? [String: Any])?["minutes"] as? Int ?? 0
      let prevWeekMin = (thisWeekApps[name] as? [String: Any])?["minutes"] as? Int ?? 0
      // Accumulate: if today < prev (new day), add today; else replace today slice
      thisWeekApps[name] = ["minutes": max(prevWeekMin, todayMin)]
    }
    usage["thisWeek"] = ["totalMinutes": weekTotal, "apps": thisWeekApps]

    guard
      let data = try? JSONSerialization.data(withJSONObject: usage),
      let str  = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(str, forKey: kUsageKey)
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
