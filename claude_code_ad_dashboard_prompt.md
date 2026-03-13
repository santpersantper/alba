# Claude Code Prompt: Ad Performance Dashboard — AdDashboardScreen

---

## Context

I'm building **Alba**, an Expo bare React Native app. Alba is a geo-restricted local social media platform where local businesses and event organizers can run ads targeting users within a specific radius. The advertising model is intentionally different from Meta/TikTok: **no virality, no algorithmic amplification, no behavioral surveillance** — ads reach users who have explicitly opted into seeing that category of content.

Any Alba user with a business profile can become an ad buyer. I need a full **AdDashboardScreen** — an in-app dashboard that gives ad buyers the same quality of insight that Meta Ads Manager or TikTok Ads Manager offers, calibrated to Alba's local/geo model.

The ads backend does not exist yet. You will build both the backend data layer and the frontend screen from scratch.

Read the **entire codebase** before writing anything. Specifically understand:
- Navigation structure — how to add `AdDashboardScreen` and how to reach it from a business profile
- Existing database/backend (Supabase, Firebase, or other) — all new tables must use the same backend
- `useUserPreferences` hook — check if `isBusinessProfile` or equivalent flag exists; if not, note where to add it
- Existing styling conventions, color palette, and component patterns
- Any existing ad-related code, even placeholder — do not duplicate or conflict with it
- The real-time subscription pattern (used in chat/diffusion lists) — you will reuse it for live metric updates

Do not write a single line of code before completing this read. Stop and explain any conflicts before proceeding.

---

## Deliverables

### 1. Database schema

Using the existing backend (Supabase/Firebase — determine from codebase), create the following tables/collections:

**`ads`** — one record per ad campaign:
```js
{
  id: string,
  advertiserId: string,          // Alba user ID
  advertiserName: string,
  title: string,                 // ad headline
  body: string,                  // ad copy
  mediaUrl: string | null,       // image or video
  mediaType: "image" | "video" | null,
  ctaLabel: string,              // e.g. "Buy Tickets", "Learn More", "Visit Us"
  ctaUrl: string,                // deep link or external URL
  radiusKm: number,              // geo targeting radius
  centerLat: number,             // targeting center coordinates
  centerLng: number,
  targetCategories: string[],    // user interest categories opted into
  budgetEuros: number,           // total campaign budget
  spentEuros: number,            // running total spent
  costPerImpressionEuros: number,// CPM-equivalent rate
  status: "draft"|"active"|"paused"|"completed"|"archived",
  startDate: timestamp,
  endDate: timestamp | null,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**`ad_events`** — one record per user interaction with an ad:
```js
{
  id: string,
  adId: string,
  userId: string,                // recipient user ID
  eventType: "impression"        // ad was shown
           | "view"              // user watched >3s (video) or dwelled >2s (image)
           | "click"             // CTA tapped
           | "save"              // user saved/bookmarked the ad
           | "hide"              // user dismissed/hid the ad
           | "report",           // user reported the ad
  occurredAt: timestamp,
  userLat: number,               // user's location at event time
  userLng: number,
  distanceFromCenterKm: number,  // how far user was from ad center
  sessionDurationSeconds: number | null // for "view" events only
}
```

**`ad_daily_summaries`** — pre-aggregated daily rollups (written by a backend job or trigger):
```js
{
  id: string,
  adId: string,
  date: string,                  // "YYYY-MM-DD"
  impressions: number,
  views: number,
  clicks: number,
  saves: number,
  hides: number,
  reports: number,
  uniqueUsers: number,
  spentEuros: number,
  avgDistanceKm: number          // average distance of users who saw the ad
}
```

Document the full schema in a comment block at the top of every file that interacts with these collections.

---

### 2. Backend: ad metrics API endpoints

Add the following to the existing `/server/index.js`:

**`GET /ads/:advertiserId`**
- Returns all ads for the given advertiser, ordered by `createdAt` desc
- Include computed fields: `totalImpressions`, `totalClicks`, `totalViews`, `ctr` (click-through rate), `vtr` (view-through rate), `totalSpent`

**`GET /ads/:adId/metrics`**
- Accepts query params: `period=7d|30d|alltime`, `groupBy=day|week`
- Returns:
  ```js
  {
    summary: { impressions, views, clicks, saves, hides, ctr, vtr, avgCpm, totalSpent, budgetRemaining, uniqueReach, avgDistanceKm },
    timeSeries: [ { date, impressions, views, clicks, saves, spentEuros } ],
    audienceBreakdown: {
      byDistance: [ { rangeKm: "0-1", count }, { rangeKm: "1-3", count }, ... ],
      byHour: [ { hour: 0, impressions }, ... ],   // 0–23
      byDay: [ { day: "Mon", impressions }, ... ]
    },
    comparison: {
      // same metrics for the equivalent prior period
      impressions, views, clicks, ctr, vtr, totalSpent,
      impressionsDelta: number,   // % change vs prior period
      clicksDelta: number,
      ctrDelta: number
    }
  }
  ```

**`POST /ads/:adId/events`**
- Accepts: `{ userId, eventType, userLat, userLng, sessionDurationSeconds? }`
- Writes one record to `ad_events`
- Updates `spentEuros` on the parent `ads` record if `eventType === "impression"` (cost-per-impression model)
- Returns: `{ success: true }`

**`GET /ads/:advertiserId/overview`**
- Returns aggregated stats across ALL of an advertiser's ads:
  ```js
  {
    totalAds: number,
    activeAds: number,
    totalImpressions: number,
    totalClicks: number,
    totalSpent: number,
    totalBudget: number,
    avgCtr: number,
    topPerformingAdId: string,
    recentActivity: [ last 5 ad_events across all ads ]
  }
  ```

All endpoints require authentication — use the existing auth middleware pattern in the codebase.

---

### 3. `useAdMetrics` hook

Create `/app/hooks/useAdMetrics.js`:

```js
const useAdMetrics = (advertiserId) => ({
  ads,                  // array of ad objects with computed fields
  overview,             // advertiser-level summary
  selectedAdId,         // currently selected ad
  setSelectedAdId,      // function
  metrics,              // metrics for selectedAdId
  period,               // "7d" | "30d" | "alltime"
  setPeriod,            // function
  loading,              // boolean
  error,                // string | null
  refreshMetrics,       // async function — manual refresh
  trackEvent,           // async function(adId, eventType, coords) — for recording events
})
```

- On mount: fetch `overview` and `ads` list for the advertiser
- When `selectedAdId` changes: fetch `metrics` for that ad at the current `period`
- When `period` changes: re-fetch `metrics`
- Auto-refresh every **5 minutes** (metrics are near-real-time, not instant)
- Seed with **realistic mock data** for development when the backend returns empty — include at least 2 mock ads with 30 days of time series data so the UI can be fully built and tested

---

### 4. AdDashboardScreen — full implementation

Build `AdDashboardScreen.js` as a scrollable screen matching Alba's visual style. The screen has four logical sections navigable via a tab bar or segmented control at the top: **Overview**, **Performance**, **Audience**, and **Ads**.

---

#### Section A: Overview tab

A summary card at the top showing the advertiser's aggregate stats across all campaigns:

- Total impressions (with delta vs prior period: ▲/▼ X%)
- Total unique reach
- Total clicks
- Average CTR across all ads
- Total spent / total budget (progress bar)
- Number of active ads

Below the summary card, a **"Your Ads" mini-list** — horizontal scrollable row of ad cards, each showing:
- Ad title (truncated)
- Status badge (active = green, paused = yellow, completed = grey)
- Impressions count
- CTR

Tapping an ad card switches to the Performance tab with that ad selected.

A **"+ Create New Ad"** button at the bottom of the overview — for now, this shows a "Coming soon" toast. Add a `// TODO: link to ad creation flow` comment.

---

#### Section B: Performance tab

**Ad selector** — a dropdown or picker at the top showing all the advertiser's ads by title. Defaults to the most recent active ad.

**Period selector** — segmented control: `7 days | 30 days | All time`

**KPI cards row** — 2×3 grid of metric cards, each showing:
- Metric name
- Value (large, bold)
- Delta vs prior period (▲ green / ▼ red with percentage)

Metrics to show:
1. **Impressions** — times the ad was shown
2. **Unique Reach** — distinct users who saw it
3. **Views** — users who engaged for >2s (Alba's quality engagement metric — explain in a tooltip: "Users who spent more than 2 seconds with your ad")
4. **Clicks** — CTA taps
5. **CTR** — clicks / impressions, shown as percentage
6. **VTR** — views / impressions (View-Through Rate — Alba's primary quality metric given its non-viral model)

**Important framing note:** Add a subtle info banner below the KPI grid:
> "💡 On Alba, ads reach opted-in users in your area — not the entire internet. Expect lower impressions but significantly higher intent and relevance."

This sets honest expectations and turns the smaller reach into a feature, not a bug.

**Time series chart** — a line chart showing daily impressions, views, and clicks over the selected period. Use `react-native-chart-kit` or `victory-native` — check which is already in the project, install the lighter one if neither exists. Requirements:
- Toggle lines on/off by tapping the legend
- X axis: dates (abbreviated)
- Y axis: counts
- Tooltip on press showing exact values for that day
- Smooth curves, not jagged lines
- Use Alba's color palette for line colors

**Spend tracker card:**
- Budget: €X.XX total
- Spent: €X.XX (progress bar)
- Remaining: €X.XX
- Estimated days remaining at current spend rate
- Cost per click (CPC): €X.XX
- Cost per view (CPV): €X.XX
- Effective CPM (per 1,000 impressions): €X.XX

---

#### Section C: Audience tab

Three sub-sections, each as a card:

**Geographic distribution**
- A bar chart showing impressions by distance band from the ad center:
  - 0–500m, 500m–1km, 1–2km, 2–5km, 5km+
- A text summary: "Most of your audience was within {X}km of your location"
- This is one of Alba's unique advantages — hyperlocal data Meta cannot offer

**Time patterns**
- Two small charts side by side:
  - By hour of day (0–23): when impressions peak
  - By day of week: which days perform best
- A text insight auto-generated from the data:
  ```js
  const getBestTimeInsight = (byHour, byDay) =>
    `Your ads perform best on ${bestDay} around ${bestHour}:00. Consider scheduling future campaigns accordingly.`
  ```

**Engagement quality**
- Saves rate: saves / impressions (%)
- Hide rate: hides / impressions (%) — with context: "Industry average ~2%. Below 1% is excellent."
- Report rate: reports / impressions (%) — flagged red if above 0.5%
- A health score (0–100) computed as:
  ```js
  const healthScore = Math.round(
    (vtr * 40) +           // 40% weight on view-through rate
    ((1 - hideRate) * 30) +// 30% weight on low hide rate
    (ctr * 20) +           // 20% weight on CTR
    ((1 - reportRate) * 10)// 10% weight on low report rate
  ) // clamp to 0–100
  ```
- Display health score as a colored circle gauge: green (70–100), yellow (40–69), red (0–39)
- Label: "Ad Health Score" with a tooltip explaining the formula

---

#### Section D: Ads tab

A full list of all the advertiser's ads with filtering and sorting.

**Filter row:** All | Active | Paused | Completed | Archived

**Sort options:** Most recent | Most impressions | Best CTR | Most spent

Each ad row shows:
- Ad thumbnail (image/video) or placeholder icon
- Title and first line of body copy
- Status badge
- Three key stats in a row: impressions / CTR / spent
- A ">" chevron to open the ad detail

**Ad detail view** (push navigation or bottom sheet — use existing pattern):
- Full ad preview (title, body, CTA button — non-interactive, just visual)
- All KPIs for that specific ad
- Quick actions: Pause / Resume / Archive (each updates `status` on the backend via a new `PATCH /ads/:adId/status` endpoint — add this to the server)
- "View Performance" button → switches to Performance tab with this ad selected

---

### 5. Navigation integration

Check the existing navigation structure and add `AdDashboardScreen` appropriately:

- If a business profile screen exists: add an "Ad Dashboard" button or tab there
- If no business profile screen exists: add `AdDashboardScreen` to the main navigation stack and add a `// TODO: surface this from business profile` comment
- The screen should only be accessible to users where `isBusinessProfile === true` (or equivalent — check the codebase). If that flag doesn't exist, add it to `useUserPreferences` and document where it should be set during onboarding

---

### 6. Empty states

Every section must have a well-designed empty state (not a blank screen):

- **No ads yet**: illustration placeholder + "You haven't run any ads yet. Create your first campaign to start reaching locals." + "Create Ad" button (shows "coming soon" toast)
- **No data for period**: "No activity in this period. Your ad may not have been active." 
- **Ad paused**: "This ad is paused. Resume it to start collecting new data."

---

### 7. Updated file structure

```
/server
  index.js                          ← modified: 5 new endpoints

/app
  hooks/
    useAdMetrics.js                 ← new
  screens/
    AdDashboardScreen.js            ← new
  utils/
    adHealthScore.js                ← new: health score + insight generation
```

---

## Constraints

- **Match existing code style exactly** — TypeScript if used, same component patterns, same navigation library.
- **Do not install charting libraries** if one already exists in the project — check first. If none exists, prefer `victory-native` (lighter) over `react-native-chart-kit`.
- **All currency in cents internally**, display-only conversion to euros.
- **All endpoints require authentication** — use existing auth middleware, never expose another advertiser's data.
- **Mock data must be realistic** — use plausible numbers for a small Milan local business (hundreds of impressions, not millions) to set accurate expectations.
- **The "low reach is a feature" framing** must appear in the UI — the info banner in section B is mandatory, not optional.
- **If anything conflicts with these instructions**, stop and explain before proceeding.

---

## Definition of done

- [ ] All four tabs render correctly with mock data
- [ ] Ad selector and period selector update the Performance tab correctly
- [ ] Time series chart renders with toggle-able lines and tap tooltips
- [ ] KPI cards show correct deltas vs prior period
- [ ] Geographic distribution chart shows distance bands
- [ ] Time pattern charts show by-hour and by-day breakdowns
- [ ] Ad health score computes and displays with correct color coding
- [ ] Ads list filters and sorts correctly
- [ ] Ad detail view shows preview + quick actions
- [ ] Pause/Resume/Archive update backend status correctly
- [ ] All empty states render correctly
- [ ] Dashboard is only accessible to business profile users
- [ ] No other advertiser's data is ever exposed
- [ ] All API endpoints are authenticated
