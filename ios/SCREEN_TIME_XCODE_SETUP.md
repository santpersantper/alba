# Screen Time — Xcode Setup Instructions

The JavaScript side of this feature is complete and works with mock data immediately.
Follow these steps to wire up the native iOS side on a Mac.

---

## Files already written (copy these into your Xcode project)

```
ios/
  AlbaScreenTime/
    AlbaScreenTimeModule.swift         ← main native module
    AlbaScreenTimeModule.m             ← ObjC bridge
    FamilyActivityPickerBridge.swift   ← SwiftUI picker wrapped in UIKit
    AlbaReportViewController.swift     ← hidden DeviceActivityReport view (triggers report ext)
  AlbaDeviceActivityExtension/
    AlbaDeviceActivityExtension.swift  ← DeviceActivityMonitor (interval start/end/threshold)
    Info.plist
    AlbaDeviceActivityExtension.entitlements
  AlbaDeviceActivityReport/
    AlbaDeviceActivityReport.swift     ← DeviceActivityReport extension (per-app minutes)
    Info.plist
    AlbaDeviceActivityReport.entitlements
```

---

## Prerequisites

1. **Generate the `ios/` folder** (run this on a Mac):
   ```bash
   npx expo run:ios
   ```
   This creates `ios/Alba/`, `ios/AlbaTests/`, `ios/Podfile`, etc.

2. **Set iOS deployment target to 16.0**

   In `ios/Podfile`, update the first line:
   ```ruby
   platform :ios, '16.0'
   ```
   Also in Xcode: select the `Alba` target → **General** → **Minimum Deployments** → **iOS 16.0**

---

## Step 1 — Update Podfile for both extension targets

Open `ios/Podfile` and add these two blocks **after** the main `target 'Alba' do ... end` block:

```ruby
# DeviceActivityMonitor extension (interval start/end/threshold events)
target 'AlbaDeviceActivityExtension' do
  platform :ios, '16.0'
end

# DeviceActivityReport extension (per-app minute data)
target 'AlbaDeviceActivityReport' do
  platform :ios, '16.0'
end
```

Then run:
```bash
cd ios && pod install && cd ..
```

---

## Step 2 — Add `AlbaScreenTime` files to the main app target

1. In Xcode, right-click the **Alba** group in the Project Navigator → **Add Files to "Alba"**
2. Select all four files from `ios/AlbaScreenTime/`:
   - `AlbaScreenTimeModule.swift`
   - `AlbaScreenTimeModule.m`
   - `FamilyActivityPickerBridge.swift`
   - `AlbaReportViewController.swift`
3. **Target Membership**: check `Alba` only (not any extension)
4. Click **Add**
5. If prompted to create a Swift bridging header → **Create Bridging Header**
   If `Alba-Bridging-Header.h` already exists, verify it contains:
   ```objc
   #import <React/RCTBridgeModule.h>
   ```

---

## Step 3 — Add the `AlbaDeviceActivityExtension` target (Monitor)

1. **File → New → Target**
2. Search **"Device Activity Monitor Extension"** → select it
3. Product Name: `AlbaDeviceActivityExtension`
4. Bundle Identifier: `com.anonymous.Alba.AlbaDeviceActivityExtension`
   *(replace `com.anonymous.Alba` with your real bundle ID)*
5. Language: **Swift** → **Finish**
6. Xcode generates a default `.swift` file — **delete it**
7. Right-click the new `AlbaDeviceActivityExtension` group → **Add Files**
8. Select `ios/AlbaDeviceActivityExtension/AlbaDeviceActivityExtension.swift`
   - Target Membership: `AlbaDeviceActivityExtension` only
9. Replace the generated `Info.plist` with `ios/AlbaDeviceActivityExtension/Info.plist`

---

## Step 3b — Add the `AlbaDeviceActivityReport` target (Report — per-app data)

This extension is what actually provides per-app minute counts.

1. **File → New → Target**
2. Search **"Device Activity Report Extension"** → select it
3. Product Name: `AlbaDeviceActivityReport`
4. Bundle Identifier: `com.anonymous.Alba.AlbaDeviceActivityReport`
5. Language: **Swift** → **Finish**
6. Delete the generated `.swift` file
7. Right-click the new `AlbaDeviceActivityReport` group → **Add Files**
8. Select `ios/AlbaDeviceActivityReport/AlbaDeviceActivityReport.swift`
   - Target Membership: `AlbaDeviceActivityReport` only
9. Replace the generated `Info.plist` with `ios/AlbaDeviceActivityReport/Info.plist`

---

## Step 4 — Add capabilities to the main `Alba` target

Select the `Alba` target → **Signing & Capabilities** tab:

| Capability | How to add |
|---|---|
| **Family Controls** | + Capability → "Family Controls" |
| **App Groups** | + Capability → "App Groups" → add `group.com.alba.app.screentime` |
| **Push Notifications** | + Capability → "Push Notifications" |
| **In-App Purchase** | + Capability → "In-App Purchase" |

---

## Step 5 — Add App Group to both extension targets

**AlbaDeviceActivityExtension** → Signing & Capabilities:
- **+ Capability → App Groups** → enable `group.com.alba.app.screentime`
- Set entitlements file: `ios/AlbaDeviceActivityExtension/AlbaDeviceActivityExtension.entitlements`

**AlbaDeviceActivityReport** → Signing & Capabilities:
- **+ Capability → App Groups** → enable `group.com.alba.app.screentime`
- Set entitlements file: `ios/AlbaDeviceActivityReport/AlbaDeviceActivityReport.entitlements`

---

## Step 6 — Verify the main app entitlements file

Xcode creates `ios/Alba/Alba.entitlements` automatically. Confirm it contains:

```xml
<key>com.apple.developer.family-controls</key>
<true/>
<key>com.apple.security.application-groups</key>
<array>
  <string>group.com.alba.app.screentime</string>
</array>
```

---

## Step 7 — Build and run on a physical device

```bash
npx expo run:ios --device
```

FamilyControls **does not work on the iOS Simulator**. A physical iPhone on iOS 16+ is required.

**First-run flow on device:**
1. User taps "Enable Screen Time" in UseTimeScreen
2. iOS system permission dialog appears → user taps Allow
3. `FamilyActivityPicker` sheet opens automatically → user selects Instagram, TikTok, X, etc.
4. User taps Done → selection saved, monitoring starts
5. Usage data is polled every 60 seconds via `getUsageData()`

**To let users change their tracked apps later**, call `requestAppSelection()` from the
`useScreenTime` hook (e.g. add a "Change tracked apps" row in a settings screen).

---

## Step 8 — App Store distribution

Submit the **Family Controls (Distribution)** capability request at:
https://developer.apple.com/contact/request/family-controls-distribution

Required fields:
- **App Apple ID**: numeric ID from App Store Connect (your app page → App Information)
- **Bundle ID**: your app's bundle ID
- **Category**: Personal device usage management
- **Description**: "Users monitor and voluntarily reduce their own social media screen time through goal-setting and streak tracking"

This approval is only needed for public App Store releases. Development and TestFlight builds work without it.

---

## Notes

- Raw usage minutes are **never sent to any backend** — all data lives in shared UserDefaults on-device only
- `FamilyActivityPicker` is presented automatically inside `requestAuthorization()` — no separate RN native view component is needed
- `DeviceActivityCenter` data is not real-time; the extension fires on interval boundaries (start/end of day). The JS layer polls every 60 seconds.
- Mock data (`__DEV__` + no native module) works on any simulator or Android device for UI development
