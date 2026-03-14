// AlbaDeviceActivityExtension.swift
// DeviceActivityMonitor subclass — runs in the extension process, NOT in the main app.
// Apple launches this extension automatically when DeviceActivity schedule events fire.
//
// This extension writes aggregated usage data to a shared App Group UserDefaults so that
// the main app (via AlbaScreenTimeModule.getUsageData) can read it.
//
// NOTE: DeviceActivity does not expose per-app minute counts directly via public API.
// The extension receives threshold/interval events but NOT raw minute-by-minute telemetry.
// Per-app data must be read using DeviceActivityReport (SwiftUI) or DeviceActivityFilter
// (available iOS 16+). For a full per-app breakdown you would embed a
// DeviceActivityReportExtension and use DeviceActivityReport in your SwiftUI views.
//
// This implementation writes daily interval totals and threshold flags to shared defaults,
// which is sufficient for the streak/goal logic. Per-app breakdown requires a
// DeviceActivityReport extension (future work).

import DeviceActivity
import Foundation

private let kAppGroup    = "group.com.alba.app.screentime"
private let kUsageDataKey = "alba_usage_data"

class AlbaDeviceActivityExtension: DeviceActivityMonitor {

  private var defaults: UserDefaults? { UserDefaults(suiteName: kAppGroup) }

  // Called when the monitoring interval starts (e.g., midnight)
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    // Reset today's counters for the new interval
    guard let defaults else { return }
    var usage = loadUsage(defaults)
    usage["today"] = ["totalMinutes": 0, "apps": [:]] as [String: Any]
    usage["lastUpdated"] = iso8601Now()
    saveUsage(usage, defaults)
  }

  // Called when the monitoring interval ends (e.g., 23:59)
  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    guard let defaults else { return }
    // Promote today's total into dailyTotals for the current weekday
    var usage = loadUsage(defaults)
    let todayMinutes = (usage["today"] as? [String: Any])?["totalMinutes"] as? Int ?? 0
    let dayKey = currentWeekdayKey()
    var dailyTotals = usage["dailyTotals"] as? [String: Int] ?? defaultDailyTotals()
    dailyTotals[dayKey] = todayMinutes

    // Recalculate this-week total
    let weekTotal = dailyTotals.values.reduce(0, +)
    var thisWeek = usage["thisWeek"] as? [String: Any] ?? [:]
    thisWeek["totalMinutes"] = weekTotal
    usage["dailyTotals"] = dailyTotals
    usage["thisWeek"] = thisWeek
    usage["lastUpdated"] = iso8601Now()
    saveUsage(usage, defaults)
  }

  // Called when a threshold event fires (e.g., 80% of daily goal reached)
  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    super.eventDidReachThreshold(event, activity: activity)
    guard let defaults else { return }
    // Write a flag that the RN layer can poll to show a local notification
    defaults.set(true, forKey: "alba_threshold_reached")
    defaults.set(iso8601Now(), forKey: "alba_threshold_reached_at")
  }

  // MARK: - Helpers

  private func loadUsage(_ defaults: UserDefaults) -> [String: Any] {
    guard
      let json = defaults.string(forKey: kUsageDataKey),
      let data = json.data(using: .utf8),
      let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return [
        "lastUpdated": iso8601Now(),
        "today": ["totalMinutes": 0, "apps": [:]] as [String: Any],
        "thisWeek": ["totalMinutes": 0, "apps": [:]] as [String: Any],
        "dailyTotals": defaultDailyTotals()
      ]
    }
    return obj
  }

  private func saveUsage(_ usage: [String: Any], _ defaults: UserDefaults) {
    if let data = try? JSONSerialization.data(withJSONObject: usage),
       let str  = String(data: data, encoding: .utf8) {
      defaults.set(str, forKey: kUsageDataKey)
    }
  }

  private func currentWeekdayKey() -> String {
    let keys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return keys[Calendar.current.component(.weekday, from: Date()) - 1]
  }

  private func defaultDailyTotals() -> [String: Int] {
    return ["Mon": 0, "Tue": 0, "Wed": 0, "Thu": 0, "Fri": 0, "Sat": 0, "Sun": 0]
  }

  private func iso8601Now() -> String {
    ISO8601DateFormatter().string(from: Date())
  }
}
