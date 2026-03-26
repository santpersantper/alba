// AlbaDeviceActivityReport.swift
// DeviceActivityReportExtension — invoked by the system when the main app renders
// a DeviceActivityReport SwiftUI view (via AlbaReportViewController).
// Reads per-app usage via DeviceActivityResults, reads JS-written style config
// from the app group UserDefaults, and renders a styled native UI.

import CoreText
import DeviceActivity
import SwiftUI

private let kReportContext = DeviceActivityReport.Context(rawValue: "alba.report")
private let kAppGroup      = "group.com.alba.app.screentime"
private let kStyleKey      = "alba_report_style"

// MARK: - Style config (written by JS via setReportStyle, read here)

struct AlbaStyleConfig {
  let bgTop:             Color
  let bgBottom:          Color
  let textColor:         Color
  let subColor:          Color
  let barMet:            Color
  let barMissed:         Color
  let barEmpty:          Color
  let goalLineColor:     Color
  let dailyGoalMinutes:   Int
  let streakCount:        Int
  let motivationalTitle:  String
  let lastSevenDays:      [DayEntry]
  let noAppsText:         String
  let appsLabel:          String
  let streakDayText:      String
  let streakDaysText:     String
  let streakNoStreakText:  String
  let timeUnitH:          String
  let timeUnitM:          String

  struct DayEntry: Identifiable {
    var id: String { dayName }
    let dayName: String
    let minutes: Int?
    let metGoal: Bool?
  }

  static var `default`: AlbaStyleConfig {
    AlbaStyleConfig(
      bgTop:             Color(hexStr: "#00D36F"),
      bgBottom:          Color(hexStr: "#00B249"),
      textColor:         .white,
      subColor:          Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.75),
      barMet:            Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.92),
      barMissed:         Color(.sRGB, red: 1, green: 0.39, blue: 0.39, opacity: 0.85),
      barEmpty:          Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.25),
      goalLineColor:     Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.45),
      dailyGoalMinutes:  180,
      streakCount:        0,
      motivationalTitle:  "Screen Time",
      lastSevenDays:      [],
      noAppsText:         "No app usage recorded yet.",
      appsLabel:          "Apps",
      streakDayText:      "day streak",
      streakDaysText:     "days streak",
      streakNoStreakText:  "Start your streak today",
      timeUnitH:          "h",
      timeUnitM:          "m"
    )
  }
}

// MARK: - Config type passed from scene to view

struct AlbaReportConfig {
  let totalMinutes: Int
  let appsData:     [String: Any]
  let style:        AlbaStyleConfig
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

  func makeConfiguration(
    representing data: DeviceActivityResults<DeviceActivityData>
  ) async -> AlbaReportConfig {
    // UIAppFonts in Info.plist registers Poppins at bundle-load time.
    // registerPoppins() is also called in AlbaReportView.init() as a fallback.
    var totalSeconds: TimeInterval = 0
    var appsData: [String: Any] = [:]
    var appIndex = 0

    for await deviceData in data {
      for await segment in deviceData.activitySegments {
        for await category in segment.categories {
          for await app in category.applications {
            let seconds = app.totalActivityDuration
            totalSeconds += seconds
            let name = app.application.localizedDisplayName ?? "App\(appIndex + 1)"
            appsData[name] = ["minutes": Int(seconds / 60)]
            appIndex += 1
          }
        }
      }
    }

    let style = readStyle()
    return AlbaReportConfig(
      totalMinutes: Int(totalSeconds / 60),
      appsData: appsData,
      style: style
    )
  }

  private func readStyle() -> AlbaStyleConfig {
    guard
      let defaults = UserDefaults(suiteName: kAppGroup),
      let jsonStr   = defaults.string(forKey: kStyleKey),
      let data      = jsonStr.data(using: .utf8),
      let json      = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return .default }

    func str(_ key: String, _ fallback: String) -> String {
      json[key] as? String ?? fallback
    }

    var days: [AlbaStyleConfig.DayEntry] = []
    if let rawDays = json["lastSevenDays"] as? [[String: Any]] {
      for d in rawDays {
        let name    = d["dayName"] as? String ?? ""
        let minutes: Int? = d["minutes"] as? Int
        let metGoal: Bool?
        if let v = d["metGoal"] {
          metGoal = v as? Bool
        } else {
          metGoal = nil
        }
        days.append(AlbaStyleConfig.DayEntry(dayName: name, minutes: minutes, metGoal: metGoal))
      }
    }

    return AlbaStyleConfig(
      bgTop:             parseColor(str("bgTop",    "#00D36F")),
      bgBottom:          parseColor(str("bgBottom", "#00B249")),
      textColor:         parseColor(str("textColor","#ffffff")),
      subColor:          parseColor(str("subColor", "rgba(255,255,255,0.75)")),
      barMet:            parseColor(str("barMet",   "rgba(255,255,255,0.92)")),
      barMissed:         parseColor(str("barMissed","rgba(255,100,100,0.85)")),
      barEmpty:          parseColor(str("barEmpty", "rgba(255,255,255,0.25)")),
      goalLineColor:     parseColor(str("goalLine", "rgba(255,255,255,0.45)")),
      dailyGoalMinutes:   json["dailyGoalMinutes"]  as? Int    ?? 180,
      streakCount:        json["streakCount"]        as? Int    ?? 0,
      motivationalTitle:  json["motivationalTitle"]  as? String ?? "Screen Time",
      lastSevenDays:      days,
      noAppsText:         str("noAppsText",        "No app usage recorded yet."),
      appsLabel:          str("appsLabel",          "Apps"),
      streakDayText:      str("streakDayText",      "day streak"),
      streakDaysText:     str("streakDaysText",     "days streak"),
      streakNoStreakText:  str("streakNoStreakText", "Start your streak today"),
      timeUnitH:          str("timeUnitH",          "h"),
      timeUnitM:          str("timeUnitM",          "m")
    )
  }
}

// MARK: - Bundle token
// Bundle.main is unreliable in ExtensionKit extensions. Bundle(for: BundleToken.self)
// always resolves to the bundle containing this compiled code — unambiguously the
// AlbaDeviceActivityReport extension bundle.
private final class BundleToken {}

// MARK: - Poppins font registration

private func registerPoppins() {
  let bundle = Bundle(for: BundleToken.self)
  let names = ["Poppins-Regular", "Poppins-Bold", "Poppins-SemiBold"]
  for name in names {
    guard let url = bundle.url(forResource: name, withExtension: "ttf") else {
      print("[AlbaReport] Font file not found in bundle: \(name).ttf")
      continue
    }
    var error: Unmanaged<CFError>?
    let registered = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
    if !registered, let err = error?.takeRetainedValue() {
      print("[AlbaReport] Failed to register \(name): \(err)")
    }
  }
}

private func poppins(_ size: CGFloat) -> Font {
  Font.custom("Poppins-Regular", size: size)
}
private func poppinsBold(_ size: CGFloat) -> Font {
  Font.custom("Poppins-Bold", size: size)
}
private func poppinsSemiBold(_ size: CGFloat) -> Font {
  Font.custom("Poppins-SemiBold", size: size)
}

// MARK: - Color parsing helpers

private func parseColor(_ s: String) -> Color {
  let t = s.trimmingCharacters(in: .whitespaces)
  if t.hasPrefix("#") {
    return Color(hexStr: t)
  }
  if t.hasPrefix("rgba(") {
    let inner = String(t.dropFirst(5).dropLast(1))
    let parts = inner.split(separator: ",")
      .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    if parts.count == 4 {
      return Color(.sRGB,
                   red:     parts[0] / 255,
                   green:   parts[1] / 255,
                   blue:    parts[2] / 255,
                   opacity: parts[3])
    }
  }
  if t.hasPrefix("rgb(") {
    let inner = String(t.dropFirst(4).dropLast(1))
    let parts = inner.split(separator: ",")
      .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    if parts.count == 3 {
      return Color(.sRGB, red: parts[0]/255, green: parts[1]/255, blue: parts[2]/255)
    }
  }
  return .white
}

private extension Color {
  init(hexStr s: String) {
    let h = s.hasPrefix("#") ? String(s.dropFirst()) : s
    guard h.count == 6, let val = UInt64(h, radix: 16) else { self = .white; return }
    self.init(.sRGB,
              red:   Double((val >> 16) & 0xFF) / 255,
              green: Double((val >>  8) & 0xFF) / 255,
              blue:  Double( val        & 0xFF) / 255)
  }
}

// MARK: - Report view

private let kBarMaxH: CGFloat = 80

struct AlbaReportView: View {
  let config: AlbaReportConfig

  init(config: AlbaReportConfig) {
    self.config = config
    // Belt-and-suspenders: register fonts here too in case the @main init()
    // call completed before the extension process fully initialised CoreText.
    registerPoppins()
  }

  var body: some View {
    ZStack {
      LinearGradient(
        colors: [config.style.bgTop, config.style.bgBottom],
        startPoint: .top,
        endPoint: .bottom
      )
      .ignoresSafeArea()

      ScrollView(showsIndicators: false) {
        VStack(alignment: .leading, spacing: 0) {

          // ── Motivational title ──────────────────────────────────────────────
          Text(config.style.motivationalTitle)
            .font(poppinsBold(28))
            .foregroundColor(config.style.textColor)
            .padding(.top, 16)
            .padding(.bottom, 4)

          // ── Streak badge ────────────────────────────────────────────────────
          Text(streakText)
            .font(poppinsBold(16))
            .foregroundColor(config.style.subColor)
            .padding(.bottom, 20)

          // ── Daily progress bar ──────────────────────────────────────────────
          if config.style.dailyGoalMinutes > 0 {
            progressBar
              .padding(.bottom, 20)
          }

          // ── 7-day histogram ─────────────────────────────────────────────────
          if !config.style.lastSevenDays.isEmpty {
            histogramView
              .padding(.bottom, 20)
          }

          // ── Per-app list ────────────────────────────────────────────────────
          if sortedApps.isEmpty {
            Text(config.style.noAppsText)
              .font(poppins(14))
              .foregroundColor(config.style.subColor)
              .padding(.top, 4)
          } else {
            Text(config.style.appsLabel)
              .font(poppinsSemiBold(13))
              .foregroundColor(config.style.subColor)
              .padding(.bottom, 8)

            VStack(spacing: 0) {
              ForEach(Array(sortedApps.enumerated()), id: \.offset) { idx, item in
                HStack {
                  Text(item.name)
                    .font(poppins(15))
                    .foregroundColor(config.style.textColor)
                  Spacer()
                  Text(fmtMin(item.minutes))
                    .font(poppins(15))
                    .foregroundColor(config.style.subColor)
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 16)
                if idx < sortedApps.count - 1 {
                  Rectangle()
                    .fill(config.style.subColor.opacity(0.25))
                    .frame(height: 1)
                    .padding(.horizontal, 16)
                }
              }
            }
            .background(Color.white.opacity(0.12))
            .cornerRadius(16)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
      }
    }
  }

  // ── Progress bar ─────────────────────────────────────────────────────────────

  private var progressBar: some View {
    let goal    = config.style.dailyGoalMinutes
    let today   = config.totalMinutes
    let pct     = goal > 0 ? min(1.0, Double(today) / Double(goal)) : 0.0
    let overGoal = today > goal
    let fillColor = overGoal ? config.style.barMissed : config.style.barMet

    return VStack(alignment: .leading, spacing: 0) {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          RoundedRectangle(cornerRadius: 5)
            .fill(config.style.barEmpty)
            .frame(height: 10)
          RoundedRectangle(cornerRadius: 5)
            .fill(fillColor)
            .frame(width: max(0, geo.size.width * CGFloat(pct)), height: 10)
        }
      }
      .frame(height: 10)

      HStack {
        Text(fmtMin(today))
          .font(poppins(12))
          .foregroundColor(config.style.subColor)
        Spacer()
        Text(fmtMin(goal))
          .font(poppins(12))
          .foregroundColor(config.style.subColor)
      }
      .padding(.top, 4)
    }
  }

  // ── 7-day histogram ───────────────────────────────────────────────────────────

  private var histogramView: some View {
    // Override today's bar (last entry) with real-time data from DeviceActivityResults.
    // The JS layer's lastSevenDays.today.minutes is always 0 during the day because
    // the monitor extension only writes at midnight/23:59; config.totalMinutes has
    // the actual live value from the report extension.
    var days = config.style.lastSevenDays
    if !days.isEmpty && config.totalMinutes > 0 {
      let last = days[days.count - 1]
      let realMin = config.totalMinutes
      let metGoal: Bool? = config.style.dailyGoalMinutes > 0
        ? (realMin <= config.style.dailyGoalMinutes)
        : nil
      days[days.count - 1] = AlbaStyleConfig.DayEntry(
        dayName: last.dayName,
        minutes: realMin,
        metGoal: metGoal
      )
    }
    let daysMax = days.compactMap(\.minutes).max() ?? 0
    let maxMin  = max(max(daysMax, config.style.dailyGoalMinutes), 1)

    return VStack(spacing: 4) {
      // Bars row
      HStack(alignment: .bottom, spacing: 2) {
        ForEach(days) { day in
          HistoBarView(
            day: day,
            maxMin: maxMin,
            barMet: config.style.barMet,
            barMissed: config.style.barMissed,
            barEmpty: config.style.barEmpty,
            subColor: config.style.subColor,
            timeUnitH: config.style.timeUnitH,
            timeUnitM: config.style.timeUnitM
          )
        }
      }
      .frame(height: kBarMaxH + 16, alignment: .bottom)

      // Day labels
      HStack(spacing: 2) {
        ForEach(days) { day in
          Text(String(day.dayName.prefix(2)))
            .font(poppins(10))
            .foregroundColor(config.style.subColor)
            .frame(maxWidth: .infinity)
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private var streakText: String {
    let n = config.style.streakCount
    if n > 0 { return "🔥 \(n) \(n == 1 ? config.style.streakDayText : config.style.streakDaysText)" }
    return config.style.streakNoStreakText
  }

  private var sortedApps: [(name: String, minutes: Int)] {
    config.appsData
      .compactMap { k, v -> (name: String, minutes: Int)? in
        guard let d = v as? [String: Any], let m = d["minutes"] as? Int else { return nil }
        return (name: k, minutes: m)
      }
      .sorted { $0.minutes > $1.minutes }
  }

  private func fmtMin(_ m: Int) -> String {
    let h = config.style.timeUnitH, mn = config.style.timeUnitM
    if m == 0 { return "<1\(mn)" }
    if m < 60  { return "\(m)\(mn)" }
    let hrs = m / 60, rem = m % 60
    return rem == 0 ? "\(hrs)\(h)" : "\(hrs)\(h) \(rem)\(mn)"
  }
}

// MARK: - Histogram bar (extracted to avoid IIFE inside @ViewBuilder)

private struct HistoBarView: View {
  let day:       AlbaStyleConfig.DayEntry
  let maxMin:    Int
  let barMet:    Color
  let barMissed: Color
  let barEmpty:  Color
  let subColor:  Color
  let timeUnitH: String
  let timeUnitM: String

  private var barColor: Color {
    if day.metGoal == true  { return barMet }
    if day.metGoal == false { return barMissed }
    return barEmpty
  }

  private var barHeight: CGFloat {
    guard let mins = day.minutes else { return 4 }
    return max(4, CGFloat(mins) / CGFloat(maxMin) * kBarMaxH)
  }

  var body: some View {
    VStack(spacing: 2) {
      if let m = day.minutes {
        Text(m < 60 ? "\(m)\(timeUnitM)" : "\(m / 60)\(timeUnitH)")
          .font(poppins(8))
          .foregroundColor(subColor)
      } else {
        Text(" ").font(poppins(8))
      }
      RoundedRectangle(cornerRadius: 3)
        .fill(barColor)
        .frame(height: barHeight)
        .opacity(day.minutes != nil ? 1.0 : 0.3)
    }
    .frame(maxWidth: .infinity, alignment: .bottom)
  }
}
