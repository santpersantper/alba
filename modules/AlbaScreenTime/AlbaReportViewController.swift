// AlbaReportViewController.swift
// Presents the DeviceActivityReport SwiftUI view as a full-screen native modal.
// The AlbaDeviceActivityReport extension renders AlbaReportView (per-app usage data)
// inside it. Writing data out of the extension is sandbox-blocked, so the data is
// displayed here as native UI rather than extracted to React Native.

import DeviceActivity
import FamilyControls
import SwiftUI
import UIKit

// MARK: - DeviceActivityReport SwiftUI view

@available(iOS 16.0, *)
struct AlbaFullReportView: View {
  let selection: FamilyActivitySelection
  /// Increment to force the DeviceActivityReport to recreate itself,
  /// which re-invokes makeConfiguration with fresh data.
  let refreshId: Int

  var body: some View {
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
    .id(refreshId)
  }
}

// MARK: - UIKit container

@available(iOS 16.0, *)
final class AlbaReportViewController: UIViewController {
  private let selection: FamilyActivitySelection
  private let completion: () -> Void
  private var refreshCount = 0
  private var hosting: UIHostingController<AlbaFullReportView>!

  init(selection: FamilyActivitySelection, completion: @escaping () -> Void) {
    self.selection = selection
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
    view.backgroundColor = .systemBackground
  }

  @objc required dynamic init?(coder: NSCoder) {
    fatalError("init(coder:) not supported")
  }

  override func viewDidLoad() {
    super.viewDidLoad()

    title = "Screen Time"
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done,
      target: self,
      action: #selector(doneTapped)
    )
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .refresh,
      target: self,
      action: #selector(refreshTapped)
    )

    hosting = UIHostingController(rootView: AlbaFullReportView(selection: selection, refreshId: 0))
    hosting.view.backgroundColor = .systemBackground
    addChild(hosting)
    view.addSubview(hosting.view)
    hosting.view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
      hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    hosting.didMove(toParent: self)
  }

  @objc private func refreshTapped() {
    refreshCount += 1
    hosting.rootView = AlbaFullReportView(selection: selection, refreshId: refreshCount)
  }

  @objc private func doneTapped() {
    dismiss(animated: true) { self.completion() }
  }
}
