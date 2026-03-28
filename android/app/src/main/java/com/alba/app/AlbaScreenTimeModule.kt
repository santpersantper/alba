package com.alba.app

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class AlbaScreenTimeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AlbaScreenTimeModule"

    // ── Permission check ──────────────────────────────────────────────────────

    private fun hasUsageStatsPermission(): Boolean {
        val context = reactApplicationContext
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                context.applicationInfo.uid,
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                context.applicationInfo.uid,
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    // ── JS-callable methods ───────────────────────────────────────────────────

    @ReactMethod
    fun getAuthorizationStatus(promise: Promise) {
        try {
            val map = WritableNativeMap()
            map.putBoolean("authorized", hasUsageStatsPermission())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_STATUS", e.message)
        }
    }

    /**
     * Opens the Usage Access settings screen so the user can grant the
     * PACKAGE_USAGE_STATS permission. The JS side should listen for AppState
     * 'active' events and re-check authorization after returning.
     */
    @ReactMethod
    fun requestAuthorization(promise: Promise) {
        try {
            if (hasUsageStatsPermission()) {
                promise.resolve(null)
                return
            }
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactApplicationContext.startActivity(intent)
            // Resolve immediately — JS re-checks when the app comes back to foreground
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_AUTH", e.message)
        }
    }

    /**
     * Reads today's and this-week's usage from UsageStatsManager and returns
     * a JSON string matching the data shape expected by useScreenTime.js:
     * { lastUpdated, today: { totalMinutes, apps }, thisWeek: { totalMinutes, apps }, dailyTotals }
     */
    @ReactMethod
    fun getUsageData(promise: Promise) {
        if (!hasUsageStatsPermission()) {
            promise.reject("ERR_PERMISSION", "Usage access not granted")
            return
        }
        try {
            val result = buildUsageJson()
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR_USAGE", e.message)
        }
    }

    /** Alias for getUsageData — matches iOS refreshReport() interface */
    @ReactMethod
    fun refreshReport(promise: Promise) {
        getUsageData(promise)
    }

    /**
     * startMonitoring is a no-op on Android — UsageStatsManager is always
     * available once permission is granted; no explicit monitoring session needed.
     */
    @ReactMethod
    fun startMonitoring(options: ReadableMap, promise: Promise) {
        promise.resolve(null)
    }

    @ReactMethod
    fun stopMonitoring(promise: Promise) {
        promise.resolve(null)
    }

    /**
     * requestAppSelection — on Android there is no equivalent to iOS
     * FamilyActivityPicker (individual app blocking requires DevicePolicyManager
     * or Accessibility Service which are device-owner-only).
     * Returns true so the JS flow continues without error.
     */
    @ReactMethod
    fun requestAppSelection(promise: Promise) {
        promise.resolve(true)
    }

    /** Returns all user-launchable installed apps as [{packageName, label}]. */
    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
            }
            val resolveInfos = pm.queryIntentActivities(mainIntent, 0)
            val result = WritableNativeArray()
            for (ri in resolveInfos) {
                val pkg = ri.activityInfo.packageName
                if (pkg == reactApplicationContext.packageName) continue
                val label = ri.loadLabel(pm).toString()
                val map = WritableNativeMap()
                map.putString("packageName", pkg)
                map.putString("label", label)
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR_APPS", e.message)
        }
    }

    /** Persists the selected package names to SharedPreferences. */
    @ReactMethod
    fun setTrackedApps(packages: ReadableArray, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("AlbaScreenTime", Context.MODE_PRIVATE)
            val list = mutableListOf<String>()
            for (i in 0 until packages.size()) {
                val pkg = packages.getString(i) ?: continue
                list.add(pkg)
            }
            prefs.edit().putString("trackedApps", org.json.JSONArray(list).toString()).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_SET_APPS", e.message)
        }
    }

    // ── UsageStats aggregation ─────────────────────────────────────────────────

    /** Returns the set of tracked package names, or null if none are saved (= track all). */
    private fun getTrackedPackages(): Set<String>? {
        val prefs = reactApplicationContext.getSharedPreferences("AlbaScreenTime", Context.MODE_PRIVATE)
        val json = prefs.getString("trackedApps", null) ?: return null
        return try {
            val arr = org.json.JSONArray(json)
            val set = mutableSetOf<String>()
            for (i in 0 until arr.length()) set.add(arr.getString(i))
            if (set.isEmpty()) null else set
        } catch (e: Exception) {
            null
        }
    }

    private fun buildUsageJson(): String {
        val context = reactApplicationContext
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        val now = System.currentTimeMillis()

        // Today: midnight → now
        val todayStart = startOfDayMs()
        val todayStats = usm.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            todayStart, now
        ) ?: emptyList()

        // This week: last Monday midnight → now
        val weekStart = startOfWeekMs()
        val weekStats = usm.queryUsageStats(
            UsageStatsManager.INTERVAL_WEEKLY,
            weekStart, now
        ) ?: emptyList()

        val trackedPackages = getTrackedPackages()

        // Build today app map (skip system packages with no foreground time)
        val todayApps = JSONObject()
        var todayTotal = 0L
        for (stat in todayStats) {
            val mins = stat.totalTimeInForeground / 60_000
            if (mins <= 0) continue
            if (trackedPackages != null && !trackedPackages.contains(stat.packageName)) continue
            todayTotal += mins
            val label = getAppLabel(stat.packageName)
            val appObj = JSONObject()
            appObj.put("minutes", mins)
            appObj.put("bundleId", stat.packageName)
            todayApps.put(label, appObj)
        }

        // Build weekly app map
        val weekApps = JSONObject()
        var weekTotal = 0L
        for (stat in weekStats) {
            val mins = stat.totalTimeInForeground / 60_000
            if (mins <= 0) continue
            if (trackedPackages != null && !trackedPackages.contains(stat.packageName)) continue
            weekTotal += mins
            val label = getAppLabel(stat.packageName)
            val appObj = JSONObject()
            appObj.put("minutes", mins)
            appObj.put("bundleId", stat.packageName)
            weekApps.put(label, appObj)
        }

        // Daily totals for the past 7 days (Mon–Sun order to match iOS)
        val dailyTotals = buildDailyTotals(usm, now, trackedPackages)

        val root = JSONObject()
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        root.put("lastUpdated", isoFormat.format(Date()))
        root.put("today", JSONObject().apply {
            put("totalMinutes", todayTotal)
            put("apps", todayApps)
        })
        root.put("thisWeek", JSONObject().apply {
            put("totalMinutes", weekTotal)
            put("apps", weekApps)
        })
        root.put("dailyTotals", dailyTotals)

        return root.toString()
    }

    private fun buildDailyTotals(usm: UsageStatsManager, now: Long, trackedPackages: Set<String>?): JSONObject {
        val dayNames = arrayOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
        val result = JSONObject()
        val cal = Calendar.getInstance()

        // Walk back 6 days + today
        for (i in 6 downTo 0) {
            val start = startOfDayMs(daysBack = i)
            val end = if (i == 0) now else startOfDayMs(daysBack = i - 1)
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end) ?: emptyList()
            val totalMins = if (trackedPackages != null) {
                stats.filter { trackedPackages.contains(it.packageName) }
                    .sumOf { it.totalTimeInForeground } / 60_000
            } else {
                stats.sumOf { it.totalTimeInForeground } / 60_000
            }

            cal.timeInMillis = start
            val dayIdx = cal.get(Calendar.DAY_OF_WEEK) - 1 // 0=Sun
            result.put(dayNames[dayIdx], totalMins)
        }

        return result
    }

    // ── Time helpers ───────────────────────────────────────────────────────────

    private fun startOfDayMs(daysBack: Int = 0): Long {
        val cal = Calendar.getInstance().apply {
            add(Calendar.DAY_OF_YEAR, -daysBack)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis
    }

    private fun startOfWeekMs(): Long {
        val cal = Calendar.getInstance().apply {
            firstDayOfWeek = Calendar.MONDAY
            set(Calendar.DAY_OF_WEEK, Calendar.MONDAY)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun getAppLabel(packageName: String): String {
        return try {
            val pm = reactApplicationContext.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            packageName
        }
    }
}
