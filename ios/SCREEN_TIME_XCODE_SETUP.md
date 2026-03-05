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

**Bundle IDs:**
- Main app: `com.albaapp.alba`
- DeviceActivity Monitor extension: `com.albaapp.alba.AlbaDeviceActivityExtension`
- DeviceActivityReport extension: `com.albaapp.alba.AlbaDeviceActivityReport`

---

## Prerequisites

1. **Generate the `ios/` folder** (run this on a Mac):
   ```bash
   npx expo prebuild --platform ios
   ```
   This creates `ios/Alba/`, `ios/Alba.xcodeproj`, `ios/Podfile`, etc.
   The main app's `Alba.entitlements` file is **automatically created** with FamilyControls
   and the App Group already set — because `app.config.js` has `ios.entitlements` configured.

   > Alternatively `npx expo run:ios` does a prebuild + build in one step, but `prebuild` alone
   > lets you inspect and adjust the Xcode project before building.

2. **Set iOS deployment target to 16.0**

   After prebuild, open `ios/Podfile` and ensure the first line reads:
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
4. Bundle Identifier: `com.albaapp.alba.AlbaDeviceActivityExtension`
5. Language: **Swift** → **Finish**
6. Xcode generates a default `.swift` file — **delete it**
7. Right-click the new `AlbaDeviceActivityExtension` group → **Add Files**
8. Select `ios/AlbaDeviceActivityExtension/AlbaDeviceActivityExtension.swift`
   - Target Membership: `AlbaDeviceActivityExtension` only
9. Replace the generated `Info.plist` with `ios/AlbaDeviceActivityExtension/Info.plist`

---

## Step 3b — Add the `AlbaDeviceActivityReport` target (Report — per-app data)

This extension provides per-app minute counts.

1. **File → New → Target**
2. Search **"Device Activity Report Extension"** → select it
3. Product Name: `AlbaDeviceActivityReport`
4. Bundle Identifier: `com.albaapp.alba.AlbaDeviceActivityReport`
5. Language: **Swift** → **Finish**
6. Delete the generated `.swift` file
7. Right-click the new `AlbaDeviceActivityReport` group → **Add Files**
8. Select `ios/AlbaDeviceActivityReport/AlbaDeviceActivityReport.swift`
   - Target Membership: `AlbaDeviceActivityReport` only
9. Replace the generated `Info.plist` with `ios/AlbaDeviceActivityReport/Info.plist`

---

## Step 4 — Add capabilities to the main `Alba` target

> **The FamilyControls entitlement and App Group are already in `ios/Alba/Alba.entitlements`**
> because `app.config.js` configures them via `ios.entitlements`. Expo's prebuild writes them
> automatically. You only need to **verify** they are present in Xcode and add any missing ones.

Select the `Alba` target → **Signing & Capabilities** tab:

| Capability | Status |
|---|---|
| **Family Controls** | ✅ Auto-added by Expo prebuild (verify it appears) |
| **App Groups** (`group.com.alba.app.screentime`) | ✅ Auto-added by Expo prebuild (verify it appears) |
| **Push Notifications** | Add manually if not present: + Capability → "Push Notifications" |
| **In-App Purchase** | Add manually if not present: + Capability → "In-App Purchase" |

If Family Controls or App Groups are missing from the Signing & Capabilities UI (even though they're in the `.entitlements` file), click **+ Capability** and add them — Xcode will sync with the entitlements file automatically.

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

Expo's prebuild creates `ios/Alba/Alba.entitlements`. Confirm it contains:

```xml
<key>com.apple.developer.family-controls</key>
<true/>
<key>com.apple.security.application-groups</key>
<array>
  <string>group.com.alba.app.screentime</string>
</array>
```

If it doesn't, add the keys manually or re-run `npx expo prebuild --platform ios`.

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
5. Usage data is polled every 60 seconds via `refreshReport()` → `getUsageData()`

**To let users change their tracked apps later**, call `requestAppSelection()` from the
`useScreenTime` hook (e.g. add a "Change tracked apps" row in a settings screen).

---

## Step 8 — App Store distribution

✅ **Family Controls (Distribution) capability has already been approved by Apple.**

When submitting to the App Store, ensure you select the correct provisioning profiles that
include the Family Controls entitlement. In App Store Connect, confirm that
`com.apple.developer.family-controls` is listed under your app's capabilities.

Development and TestFlight builds work without any additional steps.

---

## Notes

- Raw usage minutes are **never sent to any backend** — all data lives in shared UserDefaults on-device only
- `FamilyActivityPicker` is presented automatically inside `requestAuthorization()` — no separate RN native view component is needed
- `DeviceActivityCenter` data is not real-time; the extension fires on interval boundaries (start/end of day). The JS layer polls every 60 seconds.
- Mock data (`__DEV__` + no native module) works on any simulator or Android device for UI development
