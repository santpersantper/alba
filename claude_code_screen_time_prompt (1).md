# Claude Code Prompt: Screen Time Monitoring — UseTimeScreen

---

## Context

I'm building **Alba**, an Expo bare React Native app (iOS focus). One of Alba's core USPs is helping users reduce their social media usage. I have a `UseTimeScreen.js` that is currently a full placeholder — I need you to implement it completely, matching the design shown in the reference screenshot.

The screen shows:
- A motivational header based on goal progress
- Percentage reductions since last Friday and yesterday
- A streak counter with day-by-day checkmarks (Mon–Fri)
- Current goals with "Change" links
- Social media time today (total + per-app breakdown: Instagram, TikTok, X)
- Social media time this week (total + per-app breakdown)

This feature requires a **native iOS module** using Apple's Screen Time frameworks:
- `FamilyControls` — for requesting Screen Time authorization
- `DeviceActivity` — for monitoring app usage over time periods
- `ManagedSettings` — for future enforcement (out of scope now, but do not conflict with it)

Read the **entire codebase** before writing anything. Specifically understand:
- `UseTimeScreen.js` — current placeholder structure and any existing state/props
- The existing navigation structure — how this screen is reached
- `useUserPreferences` hook — you will extend it with goals and streak data
- Existing styling conventions, color palette (note: the screen uses solid green `#00C853` or similar as full-screen background — confirm the exact green from any existing brand colors in the codebase)
- Any existing native modules already in the project — do not duplicate them
- How the project's `ios/` directory is structured — you will be adding a native Swift module

Do not write a single line of code before completing this read. If anything conflicts with these instructions, stop and explain before proceeding.

---

## Critical iOS setup notes

This feature requires:
1. An **App Group** shared between the main app target and a `DeviceActivityExtension` target
2. The `com.apple.developer.family-controls` entitlement on the main app target
3. A **DeviceActivity extension** target added to the Xcode project
4. Swift native module bridged to React Native via a custom NativeModule

**Before writing any code**, read the existing `ios/` directory structure and:
- Identify the main app target name
- Identify the existing bundle ID
- Check if any entitlements file already exists
- Check if an App Group is already configured
- Note the iOS deployment target (must be iOS 16.0+ for DeviceActivity)

If the deployment target is below iOS 16.0, flag this and provide instructions to update it — do not proceed without confirming this.

---

## Deliverables

### 1. iOS entitlements and capabilities

In the main app target's entitlements file (create if it doesn't exist):

```xml
<key>com.apple.developer.family-controls</key>
<true/>
<key>com.apple.security.application-groups</key>
<array>
  <string>group.com.alba.app.screentime</string>
</array>
```

In the `DeviceActivityExtension` target's entitlements:
```xml
<key>com.apple.security.application-groups</key>
<array>
  <string>group.com.alba.app.screentime</string>
</array>
```

**Provide step-by-step Xcode instructions** for:
- Adding the FamilyControls capability in Xcode (Signing & Capabilities tab)
- Creating the App Group with identifier `group.com.alba.app.screentime`
- Adding a new DeviceActivity Extension target to the project

These cannot be done in code — give clear manual instructions the developer must follow in Xcode before building.

---

### 2. DeviceActivity Extension target

Create the following files inside a new `AlbaDeviceActivityExtension/` folder in the `ios/` directory:

**`AlbaDeviceActivityExtension/AlbaDeviceActivityExtension.swift`**

A `DeviceActivityMonitor` subclass that:
- Overrides `intervalDidStart(for:)` — resets the daily usage counters in shared UserDefaults
- Overrides `intervalDidEnd(for:)` — finalizes the day's data, writes a daily summary to shared UserDefaults
- Overrides `eventDidReachThreshold(_:activity:)` — writes a notification flag to shared UserDefaults that the React Native layer can poll (for future alert functionality — just write the flag for now)

Uses `group.com.alba.app.screentime` App Group UserDefaults (`UserDefaults(suiteName:)`) to share data with the main app.

**`AlbaDeviceActivityExtension/Info.plist`** — standard DeviceActivity extension Info.plist

**`AlbaDeviceActivityExtension/AlbaDeviceActivityExtension.entitlements`** — as specified in section 1

---

### 3. Native Swift module: `AlbaScreenTimeModule`

Create the following files in `ios/AlbaScreenTime/`:

**`AlbaScreenTimeModule.swift`**

Expose the following methods to React Native via `@objc` and `RCT_EXTERN_METHOD`:

```swift
// Request FamilyControls authorization
// Resolves with { authorized: true } or rejects with error message
requestAuthorization(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)

// Start monitoring a DeviceActivity schedule
// schedule: { startHour: Int, startMinute: Int, endHour: Int, endMinute: Int }
// Resolves with { success: true } or rejects
startMonitoring(schedule: NSDictionary, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)

// Stop all active DeviceActivity monitoring
stopMonitoring(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)

// Read usage data from shared UserDefaults (written by the extension)
// Resolves with the usage data object (see data shape below)
getUsageData(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)

// Check if FamilyControls authorization has been granted
// Resolves with { authorized: Bool }
getAuthorizationStatus(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)
```

**Tracked apps** — hardcode the following bundle IDs as the monitored app set:
```swift
let trackedApps: Set<String> = [
  "com.burbn.instagram",   // Instagram
  "com.zhiliaoapp.musically", // TikTok
  "com.atebits.Tweetie2",  // X (Twitter)
  "com.google.youtube",    // YouTube
  "com.facebook.Facebook"  // Facebook
]
```

Include a comment explaining that `DeviceActivityFilter` uses `ApplicationToken` sets derived from `FamilyActivityPicker` selection OR hardcoded bundle IDs — and that Apple's privacy model means bundle IDs must be wrapped in `ActivityCategoryToken` or selected via `FamilyActivityPicker`. If direct bundle ID filtering is not possible due to Apple's privacy restrictions, implement the `FamilyActivityPicker` approach instead and document this clearly.

**Data shape written to shared UserDefaults** (JSON-encoded):
```json
{
  "lastUpdated": "ISO8601 timestamp",
  "today": {
    "totalMinutes": 119,
    "apps": {
      "Instagram": { "minutes": 62, "bundleId": "com.burbn.instagram" },
      "TikTok": { "minutes": 34, "bundleId": "com.zhiliaoapp.musically" },
      "X": { "minutes": 23, "bundleId": "com.atebits.Tweetie2" }
    }
  },
  "thisWeek": {
    "totalMinutes": 359,
    "apps": {
      "Instagram": { "minutes": 182 },
      "TikTok": { "minutes": 122 },
      "X": { "minutes": 55 }
    }
  },
  "dailyTotals": {
    "Mon": 85, "Tue": 72, "Wed": 68, "Thu": 71, "Fri": 63, "Sat": 0, "Sun": 0
  }
}
```

**`AlbaScreenTimeModule.m`** (Objective-C bridge file):
```objc
RCT_EXTERN_MODULE(AlbaScreenTimeModule, NSObject)
// RCT_EXTERN_METHOD declarations for all methods above
```

**`ios/AlbaScreenTime/AlbaScreenTime.podspec`** — if needed for the module to be picked up by CocoaPods

Provide the exact lines to add to `ios/Podfile` to include both the module and the extension target.

---

### 4. JavaScript bridge: `useScreenTime` hook

Create `/app/hooks/useScreenTime.js`:

```js
// Wraps the AlbaScreenTimeModule native module
// Exposes:
const useScreenTime = () => ({
  authorized,           // boolean
  usageData,            // the data shape from section 3
  requestAuthorization, // async function → requests FamilyControls auth
  startMonitoring,      // async function → starts DeviceActivity schedule (midnight to midnight)
  stopMonitoring,       // async function
  refreshUsageData,     // async function → calls getUsageData and updates state
  loading,              // boolean
  error,                // string | null
})
```

Implementation requirements:
- On mount: call `getAuthorizationStatus()`. If authorized, call `getUsageData()` and start a **polling interval every 60 seconds** to refresh data (DeviceActivity data is not real-time push — it must be polled)
- If not authorized: set `authorized = false`, do not poll
- `requestAuthorization` should call the native method, then on success immediately call `startMonitoring` with a daily schedule (00:00 to 23:59) and `getUsageData`
- Handle the case where the native module is unavailable (Android or simulator without entitlements) — return mock data in development:
```js
const MOCK_DATA = {
  today: { totalMinutes: 119, apps: { Instagram: { minutes: 62 }, TikTok: { minutes: 34 }, X: { minutes: 23 } } },
  thisWeek: { totalMinutes: 359, apps: { Instagram: { minutes: 182 }, TikTok: { minutes: 122 }, X: { minutes: 55 } } },
  dailyTotals: { Mon: 85, Tue: 72, Wed: 68, Thu: 71, Fri: 0, Sat: 0, Sun: 0 }
}
```
- Clean up polling interval on unmount

---

### 5. useUserPreferences — new fields

Add the following to the existing `useUserPreferences` hook:

```js
{
  // Screen time goals
  screenTimeGoalReductionPercent: 10,   // % reduction per week (default 10%)
  screenTimeGoalDailyMaxMinutes: 180,   // daily max in minutes (default 3h = 180min)

  // Streak tracking
  streakDays: {
    Mon: false, Tue: false, Wed: false,
    Thu: false, Fri: false, Sat: false, Sun: false
  },
  currentStreakCount: 0,                // number of consecutive days goal met
  lastStreakUpdate: null,               // ISO date string — last date streak was evaluated
}
```

**Streak logic** (implement as a function `evaluateStreak(usageData, goals)` in a separate `/app/utils/streakUtils.js` file):
- A day is "kept" if `dailyTotal <= screenTimeGoalDailyMaxMinutes`
- Called once per day (check `lastStreakUpdate` — if it's today's date, skip)
- Updates `streakDays` for the current week (Mon–Sun)
- Increments `currentStreakCount` if today's goal was met, resets to 0 if not
- Writes updated values back to `useUserPreferences`

---

### 6. UseTimeScreen.js — full implementation

Rewrite `UseTimeScreen.js` completely, matching the reference screenshot precisely.

**Full-screen green background**: use Alba's primary green (check codebase — likely `#00C853` or similar). Every element is white text on green. No white cards except the "Social media time today/this week" section which uses a slightly darker green rounded card (semi-transparent overlay).

**Layout top to bottom:**

#### Motivational header
Dynamic text based on goal progress:
```js
const getMotivationalMessage = (reductionSinceLastWeek) => {
  if (reductionSinceLastWeek > 0) return "You're on your way to meet your goal, keep it up! 💪"
  if (reductionSinceLastWeek === 0) return "Same as last week. You can do better! 🎯"
  if (reductionSinceLastWeek < 0) return "You're using more than last week. Let's get back on track 💚"
}
```
Large bold white text, left-aligned, matching the screenshot's font weight and size.

#### Stats row
Three lines, each with an icon:
- `▼ {X}%  since last Friday` — calculate from `usageData.thisWeek.totalMinutes` vs previous week total (store previous week total in `useUserPreferences` as `lastWeekTotalMinutes`)
- `▼ {X}%  since yesterday` — calculate from `usageData.today.totalMinutes` vs yesterday's total from `dailyTotals`
- `📊 {N} straight days keeping your goal` — from `currentStreakCount`

Show `▲` instead of `▼` and a different color (lighter white / warning tone) if usage went up.

#### Streak row
Five circles labeled Mon–Tue–Wed–Thu–Fri (current week only, matching screenshot).
- Filled white circle with green checkmark = goal met that day
- Empty white-outline circle = goal not yet met / future day
- Derive from `streakDays` in `useUserPreferences`

#### My current goals section
Two rows, each with a "Change" link (right-aligned, slightly transparent white):
- `{screenTimeGoalReductionPercent}% reduction per week`
- `Less than {screenTimeGoalDailyMaxMinutes / 60}h a day` (or `Xh Ymin` if not round hours)

Tapping either "Change" link opens a modal (see section 7).

#### Social media time today card
Darker green rounded card (use `rgba(0,0,0,0.15)` overlay or similar):
- Header: "Social media time today" (bold, white, smaller)
- Large display: `{Xh Ymin}` total (large white text, matching screenshot size)
- Three app icons in a row with time below each:
  - Instagram icon + `{X}h {Y}min`
  - TikTok icon + `{X}min`
  - X icon + `{X}min`
- For app icons: use `react-native-vector-icons` if already in project, or simple placeholder letter avatars styled in white — check codebase first. Do NOT fetch icons from external URLs.

#### Social media time this week card
Same card style:
- Header: "Social media time this week"
- Large display: weekly total
- Same three-app row with weekly per-app totals

#### Authorization prompt (shown instead of data if not authorized)
If `authorized === false`:
- Replace the two data cards with a single card:
  - Text: "Allow Alba to track your social media time"
  - Subtext: "We use Apple's Screen Time framework. Your data never leaves your device."
  - Button: "Enable Screen Time" → calls `requestAuthorization()`
- This is the only CTA — do not show fake/mock data when unauthorized on a real device

**Loading state**: show skeleton placeholders (simple white rounded rectangles with 0.4 opacity) where the data cards will appear, while `loading === true`.

**Error state**: if `error` is set, show a small white text error below the streak row. Do not crash.

---

### 7. Goal change modals

When user taps either "Change" link, open a bottom sheet modal (use the existing modal pattern in the codebase — check what's used):

**Change weekly reduction goal:**
- Slider or stepper: 5% to 50%, step 5%
- Current value highlighted
- "Save" button → updates `screenTimeGoalReductionPercent` in `useUserPreferences`

**Change daily max goal:**
- Stepper in 15-minute increments: 30min to 8h
- Display as hours/minutes
- "Save" button → updates `screenTimeGoalDailyMaxMinutes` in `useUserPreferences`

Both modals: on save, immediately re-evaluate streak with `evaluateStreak()`.

---

### 8. Storage decision

Before implementing storage, read the codebase and determine how `useUserPreferences` currently persists data. Use the **same storage layer** for all new screen time fields. Document your decision in a comment.

If the existing storage is AsyncStorage (local only): use it — screen time data is privacy-sensitive and should not be synced to a backend by default.

If the existing storage is Supabase/Firebase: store goals and streak data there, but **never send raw usage minutes to the backend** — keep `usageData` from `useScreenTime` local-only. Only sync goal settings and streak counts.

---

### 9. Android handling

This entire feature is **iOS only**. On Android:

- `useScreenTime` must return mock data in development and a clear "not supported" state in production
- `UseTimeScreen` must show a placeholder: "Screen time monitoring is currently available on iOS only. Android support coming soon."
- Do not crash, do not call any native methods

---

### 10. Updated file structure

```
ios/
  AlbaScreenTime/
    AlbaScreenTimeModule.swift       ← new native module
    AlbaScreenTimeModule.m           ← new ObjC bridge
  AlbaDeviceActivityExtension/
    AlbaDeviceActivityExtension.swift ← new extension
    Info.plist                        ← new
    AlbaDeviceActivityExtension.entitlements ← new
  {AppName}/
    {AppName}.entitlements            ← modified: FamilyControls + App Group
  Podfile                             ← modified

/app
  hooks/
    useScreenTime.js                  ← new
    useUserPreferences.js             ← modified: new goal + streak fields
  utils/
    streakUtils.js                    ← new
  screens/
    UseTimeScreen.js                  ← rewritten
```

---

## Constraints

- **iOS 16.0+ required** for DeviceActivity. Confirm deployment target before proceeding — flag and provide update instructions if below 16.0.
- **FamilyControls requires a physical device** for full testing. Document this clearly and ensure mock data path works on simulator.
- **Never send raw usage data to any backend.** Usage minutes stay on-device only.
- **Match existing code style exactly** — TypeScript if used, same component patterns, same styling.
- **Do not install new packages** unless strictly necessary — check existing dependencies first.
- **If Apple's privacy model prevents direct bundle ID filtering** (ApplicationToken opacity), implement `FamilyActivityPicker` and document the limitation clearly.
- **If anything in the codebase conflicts with these instructions**, stop and explain before proceeding.

---

## Definition of done

- [ ] FamilyControls authorization is requested and handled correctly
- [ ] DeviceActivity monitoring starts on authorization and persists across app restarts
- [ ] `useScreenTime` hook returns real data on physical iOS device
- [ ] Mock data path works correctly on simulator and Android
- [ ] `UseTimeScreen` matches the reference screenshot layout exactly
- [ ] Motivational header changes dynamically based on goal progress
- [ ] Streak circles reflect actual daily goal achievement
- [ ] Both "Change" links open working goal modals that persist selections
- [ ] "Social media time today" and "this week" cards show real per-app breakdowns
- [ ] Authorization prompt appears and triggers native permission flow when not yet authorized
- [ ] No raw usage data is sent to any backend
- [ ] No crashes on any handled error or edge case state
