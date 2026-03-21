// AlbaReportViewController.swift
// Presents an invisible DeviceActivityReport SwiftUI view to trigger the
// AlbaDeviceActivityReport extension. The extension runs in a separate process,
// reads live usage data from the OS, and writes it to shared UserDefaults.
//
// After a short delay (giving the extension time to write), the completion
// handler fires and the controller self-dismisses. AlbaScreenTimeModule then
// reads the freshly written data via getUsageData().

import DeviceActivity
import FamilyControls
import SwiftUI
import UIKit

// MARK: - Invisible DeviceActivityReport SwiftUI view

@available(iOS 16.0, *)
struct AlbaHiddenReportView: View {
  let selection: FamilyActivitySelection

  var body: some View {
    // DeviceActivityReport renders the AlbaDeviceActivityReport extension's output.
    // It is hidden (opacity 0, 1×1pt) — we only need the extension to be invoked
    // as a side-effect; we don't display the report visually.
    DeviceActivityReport(
      .init(rawValue: "alba.report"),
      filter: DeviceActivityFilter(
        segment: .hourly(
          during: Calendar.current.dateInterval(of: .day, for: Date()) ?? DateInterval()
        ),
        applications: selection.applicationTokens,
        categories: selection.categoryTokens,
        webDomains: selection.webDomainTokens
      )
    )
    .opacity(0)
    .frame(width: 1, height: 1)
  }
}

// MARK: - UIKit container

@available(iOS 16.0, *)
final class AlbaReportViewController: UIViewController {
  private let selection: FamilyActivitySelection
  private let completion: () -> Void

  private static let kAppGroup      = "group.com.alba.app.screentime"
  private static let kUsageKey      = "alba_usage_data"
  private static let kReportToken   = "alba_report_token"
  private static let pollInterval: TimeInterval = 0.3
  private static let pollTimeout:  TimeInterval = 10.0

  init(selection: FamilyActivitySelection, completion: @escaping () -> Void) {
    self.selection = selection
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .overCurrentContext
    view.backgroundColor = .clear
  }

  @objc required dynamic init?(coder: NSCoder) {
    fatalError("init(coder:) not supported")
  }

  override func viewDidLoad() {
    super.viewDidLoad()

    // Embed the invisible report view — triggers the extension's makeConfiguration()
    let reportView = AlbaHiddenReportView(selection: selection)
    let hosting = UIHostingController(rootView: reportView)
    hosting.view.backgroundColor = .clear
    addChild(hosting)
    view.addSubview(hosting.view)
    hosting.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    hosting.didMove(toParent: self)

    // Poll UserDefaults until makeConfiguration() writes a fresh lastUpdated,
    // then dismiss. Keeping the view alive ensures the extension isn't interrupted.
    let baseline = Self.readReportToken()
    pollForUpdate(baseline: baseline, elapsed: 0)
  }

  // Poll the report-specific token written only by AlbaDeviceActivityReport.
  // Using lastUpdated would cause a false-positive: the monitor extension's
  // intervalDidStart also writes lastUpdated, triggering an early dismiss
  // before makeConfiguration has a chance to run.
  private static func readReportToken() -> String? {
    UserDefaults(suiteName: kAppGroup)?.string(forKey: kReportToken)
  }

  private func pollForUpdate(baseline: String?, elapsed: TimeInterval) {
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.pollInterval) { [weak self] in
      guard let self = self else { return }
      let current  = Self.readReportToken()
      let timedOut = elapsed + Self.pollInterval >= Self.pollTimeout
      if current != baseline || timedOut {
        self.dismiss(animated: false) { self.completion() }
      } else {
        self.pollForUpdate(baseline: baseline, elapsed: elapsed + Self.pollInterval)
      }
    }
  }
}
