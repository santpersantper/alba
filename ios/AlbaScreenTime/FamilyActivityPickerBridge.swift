// FamilyActivityPickerBridge.swift
// Wraps SwiftUI's FamilyActivityPicker in a UIViewController so it can be
// presented from AlbaScreenTimeModule without needing a React Native view component.
//
// Apple requires FamilyActivityPicker (a native SwiftUI sheet) to obtain
// ApplicationTokens — bundle IDs cannot be used directly due to privacy restrictions.
// The user selects which apps to monitor here; the FamilyActivitySelection is then
// encoded and stored in shared UserDefaults for AlbaScreenTimeModule to read.

import SwiftUI
import FamilyControls

// MARK: - Observable model (bridges SwiftUI binding ↔ UIKit)

@available(iOS 16.0, *)
final class FamilyPickerModel: ObservableObject {
  @Published var selection = FamilyActivitySelection()
}

// MARK: - SwiftUI picker view

@available(iOS 16.0, *)
struct AlbaFamilyPickerView: View {
  @ObservedObject var model: FamilyPickerModel
  let onDone: () -> Void
  let onCancel: () -> Void

  var body: some View {
    NavigationStack {
      FamilyActivityPicker(selection: $model.selection)
        .navigationTitle("Apps to Track")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", action: onCancel)
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { onDone() }
              .fontWeight(.semibold)
          }
        }
    }
  }
}

// MARK: - UIKit container (embeds SwiftUI view as a child view controller)

@available(iOS 16.0, *)
final class AlbaFamilyPickerViewController: UIViewController {
  private let model = FamilyPickerModel()
  private let completion: (FamilyActivitySelection?) -> Void

  init(completion: @escaping (FamilyActivitySelection?) -> Void) {
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
  }

  @objc required dynamic init?(coder: NSCoder) {
    fatalError("init(coder:) not supported")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    let swiftUIView = AlbaFamilyPickerView(
      model: model,
      onDone: { [weak self] in self?.finish(cancelled: false) },
      onCancel: { [weak self] in self?.finish(cancelled: true) }
    )
    let hosting = UIHostingController(rootView: swiftUIView)
    addChild(hosting)
    view.addSubview(hosting.view)
    hosting.view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
      hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    hosting.didMove(toParent: self)
  }

  private func finish(cancelled: Bool) {
    let sel: FamilyActivitySelection? = cancelled ? nil : model.selection
    dismiss(animated: true) { [weak self] in
      self?.completion(sel)
    }
  }
}
