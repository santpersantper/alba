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
        segment: .daily(
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

  // How long to wait for the report extension to finish writing to UserDefaults.
  // 2 seconds is generous; in practice the extension finishes in well under 1s.
  private static let extensionWriteDelay: TimeInterval = 2.0

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

    // Embed the invisible report view
    let reportView = AlbaHiddenReportView(selection: selection)
    let hosting = UIHostingController(rootView: reportView)
    hosting.view.backgroundColor = .clear
    addChild(hosting)
    view.addSubview(hosting.view)
    hosting.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    hosting.didMove(toParent: self)

    // Dismiss after the extension has had time to write
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.extensionWriteDelay) { [weak self] in
      self?.dismiss(animated: false) {
        self?.completion()
      }
    }
  }
}
