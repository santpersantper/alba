/**
 * withAndroidNativeModules.js
 *
 * Expo config plugin that adds the Alba Android native modules to the project:
 *   - AlbaScreenTimeModule  (UsageStatsManager-based app usage stats)
 *   - VPNDetectorModule     (ConnectivityManager TRANSPORT_VPN check)
 *
 * What it does at prebuild time:
 *  1. Copies the four Kotlin source files into android/app/src/main/java/com/alba/app/
 *  2. Adds required permissions to AndroidManifest.xml
 *  3. Registers both ReactPackages in MainApplication.kt (or MainApplication.java)
 */

const { withDangerousMod, withAndroidManifest } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const KOTLIN_FILES = [
  "AlbaScreenTimeModule.kt",
  "AlbaScreenTimePackage.kt",
  "VPNDetectorModule.kt",
  "VPNDetectorPackage.kt",
];

// ── Step 1: Copy Kotlin source files ─────────────────────────────────────────

function withKotlinFiles(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, "scripts", "android");
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot, // android/
        "app",
        "src",
        "main",
        "java",
        "com",
        "alba",
        "app"
      );

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      for (const file of KOTLIN_FILES) {
        const srcPath = path.join(srcDir, file);
        const destPath = path.join(destDir, file);
        if (!fs.existsSync(srcPath)) {
          console.warn(`[withAndroidNativeModules] Source file not found: ${srcPath}`);
          continue;
        }
        fs.copyFileSync(srcPath, destPath);
        console.log(`[withAndroidNativeModules] Copied ${file} → ${destPath}`);
      }

      return cfg;
    },
  ]);
}

// ── Step 2: Add Android permissions ──────────────────────────────────────────

function withPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const mainApp = manifest.manifest;

    if (!mainApp["uses-permission"]) {
      mainApp["uses-permission"] = [];
    }

    const needed = [
      // UsageStatsManager — must be granted manually in Settings by the user
      "android.permission.PACKAGE_USAGE_STATS",
      // ConnectivityManager — normal permission, auto-granted at install
      "android.permission.ACCESS_NETWORK_STATE",
    ];

    for (const perm of needed) {
      const alreadyPresent = mainApp["uses-permission"].some(
        (p) => p.$?.["android:name"] === perm
      );
      if (!alreadyPresent) {
        mainApp["uses-permission"].push({ $: { "android:name": perm } });
      }
    }

    return cfg;
  });
}

// ── Step 3: Register packages in MainApplication ──────────────────────────────

function withMainApplicationPackages(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;

      // Try Kotlin first, then Java
      const ktPath = path.join(platformRoot, "app", "src", "main", "java", "com", "alba", "app", "MainApplication.kt");
      const javaPath = path.join(platformRoot, "app", "src", "main", "java", "com", "alba", "app", "MainApplication.java");

      if (fs.existsSync(ktPath)) {
        patchMainApplicationKt(ktPath);
      } else if (fs.existsSync(javaPath)) {
        patchMainApplicationJava(javaPath);
      } else {
        console.warn("[withAndroidNativeModules] MainApplication not found — skipping package registration");
      }

      return cfg;
    },
  ]);
}

function patchMainApplicationKt(filePath) {
  let src = fs.readFileSync(filePath, "utf8");

  // Already patched?
  if (src.includes("AlbaScreenTimePackage") && src.includes("VPNDetectorPackage")) return;

  // New Expo template: PackageList(this).packages.apply { // comment }
  if (src.includes("PackageList(this).packages.apply {")) {
    src = src.replace(
      /PackageList\(this\)\.packages\.apply \{[^\}]*\}/,
      `PackageList(this).packages.apply {\n              add(AlbaScreenTimePackage())\n              add(VPNDetectorPackage())\n            }`
    );
  // Old Expo template: val packages = PackageList(this).packages
  } else if (src.includes("val packages = PackageList(this).packages")) {
    src = src.replace(
      /(val packages = PackageList\(this\)\.packages)/,
      `$1\n      packages.add(AlbaScreenTimePackage())\n      packages.add(VPNDetectorPackage())`
    );
  }

  if (!src.includes("AlbaScreenTimePackage")) {
    console.warn("[withAndroidNativeModules] Could not inject packages into MainApplication.kt — pattern not found");
    return;
  }

  fs.writeFileSync(filePath, src, "utf8");
  console.log("[withAndroidNativeModules] Patched MainApplication.kt");
}

function patchMainApplicationJava(filePath) {
  let src = fs.readFileSync(filePath, "utf8");

  if (src.includes("AlbaScreenTimePackage") && src.includes("VPNDetectorPackage")) return;

  src = src.replace(
    /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);)/,
    `$1\n      packages.add(new AlbaScreenTimePackage());\n      packages.add(new VPNDetectorPackage());`
  );

  fs.writeFileSync(filePath, src, "utf8");
  console.log("[withAndroidNativeModules] Patched MainApplication.java");
}

// ── Compose ───────────────────────────────────────────────────────────────────

module.exports = function withAndroidNativeModules(config) {
  config = withKotlinFiles(config);
  config = withPermissions(config);
  config = withMainApplicationPackages(config);
  return config;
};
