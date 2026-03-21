// AlbaScreenTimeModule.swift
// Native module that bridges Apple's Screen Time frameworks (FamilyControls + DeviceActivity)
// to React Native via RCT_EXTERN_MODULE / @objc.
//
// ── Authorization + app selection flow ───────────────────────────────────────
// 1. requestAuthorization() — requests FamilyControls system permission, then
//    automatically presents FamilyActivityPicker so the user selects which apps
//    to monitor. The selection is saved to shared UserDefaults.
// 2. startMonitoring()      — reads the saved selection, starts a DeviceActivity
//    schedule (midnight → 23:59, repeating daily).
// 3. refreshReport()        — presents a hidden DeviceActivityReport view that
//    triggers AlbaDeviceActivityReport extension to write per-app minutes to
//    shared UserDefaults, then resolves with the freshly written JSON.
// 4. getUsageData()         — reads usage JSON from shared UserDefaults (cheap,
//    no extension invocation; use after refreshReport has been called).
//
// ── Apple privacy note ────────────────────────────────────────────────────────
// ApplicationTokens (needed to filter by app) are opaque for privacy reasons —
// bundle IDs cannot be used directly. FamilyActivityPicker is the only supported
// way to obtain tokens. This module presents it automatically after authorization.
// ─────────────────────────────────────────────────────────────────────────────

import Foundation
import FamilyControls
import DeviceActivity
import UIKit

private let kAppGroup    = "group.com.alba.app.screentime"
private let kUsageKey    = "alba_usage_data"
private let kSelectionKey = "alba_family_activity_selection"

@objc(AlbaScreenTimeModule)
class AlbaScreenTimeModule: NSObject {

  private let center = AuthorizationCenter.shared

  // MARK: - Authorization

  /// Step 1: Request FamilyControls permission, then show FamilyActivityPicker.
  /// Resolves with { authorized: true } after the user picks apps.
  /// Rejects if the system denies permission or the user cancels the picker.
  @objc func requestAuthorization(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      do {
        try await center.requestAuthorization(for: .individual)
      } catch {
        reject("AUTH_ERROR", error.localizedDescription, error)
        return
      }

      // Authorization granted — present app picker on the main thread
      await MainActor.run {
        self.presentAppPicker { selection in
          guard let selection = selection else {
            reject("USER_CANCELLED", "User cancelled app selection", nil)
            return
          }
          self.saveSelection(selection)
          resolve([
            "authorized": true,
            "appTokens": selection.applicationTokens.count,
            "categoryTokens": selection.categoryTokens.count,
            "webDomainTokens": selection.webDomainTokens.count,
          ])
        }
      }
    }
  }

  @objc func getAuthorizationStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let authorized = center.authorizationStatus == .approved
    resolve(["authorized": authorized])
  }

  // MARK: - App selection (standalone — lets user change tracked apps later)

  /// Presents FamilyActivityPicker without re-requesting system authorization.
  /// Use this to let users update which apps they track from Settings.
  @objc func requestAppSelection(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard center.authorizationStatus == .approved else {
      reject("NOT_AUTHORIZED", "FamilyControls authorization not granted", nil)
      return
    }
    DispatchQueue.main.async {
      self.presentAppPicker { selection in
        guard let selection = selection else {
          reject("USER_CANCELLED", "User cancelled app selection", nil)
          return
        }
        self.saveSelection(selection)
        resolve([
          "success": true,
          "appTokens": selection.applicationTokens.count,
          "categoryTokens": selection.categoryTokens.count,
          "webDomainTokens": selection.webDomainTokens.count,
        ])
      }
    }
  }

  // MARK: - Monitoring schedule

  /// schedule: { startHour: Int, startMinute: Int, endHour: Int, endMinute: Int }
  @objc func startMonitoring(
    _ schedule: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard center.authorizationStatus == .approved else {
      reject("NOT_AUTHORIZED", "FamilyControls authorization not granted", nil)
      return
    }

    guard
      let defaults   = UserDefaults(suiteName: kAppGroup),
      let data       = defaults.data(forKey: kSelectionKey),
      let selection  = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else {
      reject("NO_SELECTION", "No app selection found. Call requestAuthorization first.", nil)
      return
    }

    let startHour   = schedule["startHour"]   as? Int ?? 0
    let startMinute = schedule["startMinute"] as? Int ?? 0
    let endHour     = schedule["endHour"]     as? Int ?? 23
    let endMinute   = schedule["endMinute"]   as? Int ?? 59

    let activitySchedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: startHour, minute: startMinute),
      intervalEnd:   DateComponents(hour: endHour,   minute: endMinute),
      repeats: true
    )

    // Threshold at 80% of the daily max goal (stored by RN layer in shared defaults)
    let dailyMaxMinutes = defaults.integer(forKey: "alba_daily_max_minutes").nonZero ?? 180
    let thresholdMinutes = max(1, dailyMaxMinutes * 80 / 100)
    let thresholdEvent = DeviceActivityEvent(
      applications: selection.applicationTokens,
      categories:   selection.categoryTokens,
      threshold:    DateComponents(minute: thresholdMinutes)
    )

    do {
      let monitor = DeviceActivityCenter()
      try monitor.startMonitoring(
        DeviceActivityName("alba.daily"),
        during: activitySchedule,
        events: [DeviceActivityEvent.Name("threshold"): thresholdEvent]
      )
      resolve(["success": true])
    } catch {
      reject("MONITOR_ERROR", error.localizedDescription, error)
    }
  }

  @objc func stopMonitoring(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DeviceActivityCenter().stopMonitoring()
    resolve(["success": true])
  }

  // MARK: - Usage data

  /// Reads usage JSON written by AlbaDeviceActivityExtension from shared UserDefaults.
  @objc func getUsageData(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard
      let defaults = UserDefaults(suiteName: kAppGroup),
      let json     = defaults.string(forKey: kUsageKey)
    else {
      // Nothing recorded yet — return zeroed structure
      let empty: [String: Any] = [
        "lastUpdated": ISO8601DateFormatter().string(from: Date()),
        "today":    ["totalMinutes": 0, "apps": [:]],
        "thisWeek": ["totalMinutes": 0, "apps": [:]],
        "dailyTotals": ["Mon": 0, "Tue": 0, "Wed": 0, "Thu": 0,
                        "Fri": 0, "Sat": 0, "Sun": 0]
      ]
      if let data = try? JSONSerialization.data(withJSONObject: empty),
         let str  = String(data: data, encoding: .utf8) {
        resolve(str)
      } else {
        resolve("{}")
      }
      return
    }
    resolve(json)
  }

  // MARK: - Report (per-app data via AlbaDeviceActivityReport extension)

  /// Presents a hidden DeviceActivityReport view to trigger the
  /// AlbaDeviceActivityReport extension, waits for it to write per-app usage
  /// to shared UserDefaults, then resolves with the updated JSON.
  /// This is the primary method for getting fresh data; the 60-second polling
  /// loop in useScreenTime.js calls this instead of getUsageData() directly.
  @objc func refreshReport(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard
      let defaults  = UserDefaults(suiteName: kAppGroup),
      let data      = defaults.data(forKey: kSelectionKey),
      let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else {
      // No selection stored yet — return whatever is already in UserDefaults
      getUsageData(resolve, rejecter: reject)
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self = self, let topVC = self.topViewController() else {
        self?.getUsageData(resolve, rejecter: reject)
        return
      }

      if #available(iOS 16.0, *) {
        let reportVC = AlbaReportViewController(selection: selection) { [weak self] in
          // Extension has written data — read and resolve
          self?.getUsageData(resolve, rejecter: reject)
        }
        topVC.present(reportVC, animated: false)
      } else {
        self.getUsageData(resolve, rejecter: reject)
      }
    }
  }

  // MARK: - Private helpers

  @MainActor
  private func presentAppPicker(completion: @escaping (FamilyActivitySelection?) -> Void) {
    guard let topVC = topViewController() else {
      completion(nil)
      return
    }
    if #available(iOS 16.0, *) {
      // Pre-load existing selection so the picker shows previously chosen apps
      let existing: FamilyActivitySelection
      if let defaults = UserDefaults(suiteName: kAppGroup),
         let data     = defaults.data(forKey: kSelectionKey),
         let decoded  = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
        existing = decoded
      } else {
        existing = FamilyActivitySelection()
      }
      let picker = AlbaFamilyPickerViewController(initial: existing, completion: completion)
      topVC.present(picker, animated: true)
    } else {
      completion(nil)
    }
  }

  private func topViewController() -> UIViewController? {
    guard
      let scene  = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive }),
      let window = scene.windows.first(where: { $0.isKeyWindow })
    else { return nil }

    var top = window.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  private func saveSelection(_ selection: FamilyActivitySelection) {
    guard
      let data     = try? JSONEncoder().encode(selection),
      let defaults = UserDefaults(suiteName: kAppGroup)
    else { return }
    defaults.set(data, forKey: kSelectionKey)
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}

// MARK: - Int helper

private extension Int {
  var nonZero: Int? { self == 0 ? nil : self }
}
