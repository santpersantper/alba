/**
 * withScreenTime.js — Expo config plugin
 *
 * Runs during `expo prebuild` (and therefore during EAS Build) to wire up the
 * Screen Time native module and both extension targets without requiring manual
 * Xcode work on a Mac.
 *
 * What it does:
 *   1. Adds ios/AlbaScreenTime/ source files to the main Alba app target
 *   2. Creates AlbaDeviceActivityExtension target (DeviceActivityMonitor)
 *   3. Creates AlbaDeviceActivityReport target (DeviceActivityReport)
 *   4. Sets build settings for both extension targets (Swift version, iOS 16+,
 *      bundle IDs, entitlements path, Info.plist path)
 *   5. Appends extension target blocks to the Podfile
 *   6. Ensures the Podfile platform is iOS 16.0 (required by FamilyControls)
 *
 * NOTE: addSourceFile / addPluginFile in older xcode npm versions crash with
 * "Cannot read properties of null (reading 'path')". This plugin uses
 * addFileToTarget(), which directly writes PBXFileReference / PBXBuildFile /
 * PBXSourcesBuildPhase entries, bypassing that broken code path entirely.
 */

const { withXcodeProject, withDangerousMod, withPodfile } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_APP_TARGET = "Alba";

const SCREEN_TIME_FILES = [
  "AlbaScreenTimeModule.swift",
  "AlbaScreenTimeModule.m",
  "FamilyActivityPickerBridge.swift",
  "AlbaReportViewController.swift",
];

const EXTENSIONS = [
  {
    name: "AlbaDeviceActivityExtension",
    bundleId: "com.albaapp.alba.AlbaDeviceActivityExtension",
    sourceFile: "AlbaDeviceActivityExtension.swift",
    entitlements:
      "AlbaDeviceActivityExtension/AlbaDeviceActivityExtension.entitlements",
    infoPlist: "AlbaDeviceActivityExtension/Info.plist",
    // Path to provisioning profile relative to project root.
    // EAS only installs the main app's profile; we install extension profiles
    // ourselves (see withDangerousMod step) and reference them by UUID here.
    profilePath: "certs/AlbaDeviceActivityExtension3.mobileprovision",
  },
  {
    name: "AlbaDeviceActivityReport",
    bundleId: "com.albaapp.alba.AlbaDeviceActivityReport",
    sourceFile: "AlbaDeviceActivityReport.swift",
    entitlements:
      "AlbaDeviceActivityReport/AlbaDeviceActivityReport.entitlements",
    infoPlist: "AlbaDeviceActivityReport/Info.plist",
    profilePath: "certs/AlbaDeviceActivityReport3.mobileprovision",
    // Uses EXAppExtensionAttributes (ExtensionKit) instead of NSExtension.
    // Must be embedded in Extensions/ not PlugIns/.
    isEXExtension: true,
    // Poppins fonts bundled directly in the extension (expo-font loads fonts
    // as JS assets, not native iOS resources, so the extension can't inherit them).
    fontFiles: ["Poppins-Regular.ttf", "Poppins-Bold.ttf", "Poppins-SemiBold.ttf"],
  },
];

/**
 * Extracts the UUID from a .mobileprovision file.
 * The file is a CMS-signed envelope wrapping an XML plist; we search for the
 * UUID key directly in the raw bytes (Latin-1 read handles binary safely).
 */
function getMobileProvisionUUID(filePath) {
  try {
    const content = fs.readFileSync(filePath, "latin1");
    const m = /<key>UUID<\/key>\s*<string>([^<]+)<\/string>/.exec(content);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

// ─── Plugin entry ─────────────────────────────────────────────────────────────

module.exports = function withScreenTime(config) {
  // Step 1-4: Modify Xcode project (.pbxproj)
  config = withXcodeProject(config, (config) => {
    const proj = config.modResults;

    // ── Main target: add AlbaScreenTime source files ──────────────────────────
    const mainTarget = proj.getFirstTarget();
    if (mainTarget) {
      // Create the AlbaScreenTime group if it doesn't exist yet
      let stGroupKey = proj.findPBXGroupKey({ name: "AlbaScreenTime" });
      if (!stGroupKey) {
        const { uuid } = proj.addPbxGroup([], "AlbaScreenTime", "AlbaScreenTime");
        stGroupKey = uuid;
        const appGroupKey =
          proj.findPBXGroupKey({ name: MAIN_APP_TARGET }) ||
          proj.findPBXGroupKey({ path: MAIN_APP_TARGET });
        if (appGroupKey) proj.addToPbxGroup(stGroupKey, appGroupKey);
      }

      for (const file of SCREEN_TIME_FILES) {
        if (!fileExists(proj, file)) {
          addFileToTarget(proj, file, stGroupKey, mainTarget.uuid);
        }
      }

      // Ensure SWIFT_OBJC_BRIDGING_HEADER is set so Swift sees ObjC types
      // from <React/RCTBridgeModule.h> (RCTPromiseResolveBlock etc.).
      // Expo SDK 54 usually generates this header, but the build setting may
      // be missing if this is the first prebuild on a clean machine.
      const mainBridgingHeader = "Alba/Alba-Bridging-Header.h";
      const mainNative = mainTarget?.pbxNativeTarget ?? mainTarget;
      const mainListUUID = mainNative?.buildConfigurationList;
      const mainConfigList = proj.hash.project.objects["XCConfigurationList"]?.[mainListUUID];
      for (const ref of mainConfigList?.buildConfigurations || []) {
        const uuid = typeof ref === "object" ? ref.value : ref;
        const cfg = proj.hash.project.objects["XCBuildConfiguration"]?.[uuid];
        if (cfg?.buildSettings) {
          if (!cfg.buildSettings["SWIFT_OBJC_BRIDGING_HEADER"]) {
            cfg.buildSettings["SWIFT_OBJC_BRIDGING_HEADER"] = `"${mainBridgingHeader}"`;
          }
          // FamilyControls requires iOS 16.0+. Expo SDK 54 defaults to 15.1.
          cfg.buildSettings["IPHONEOS_DEPLOYMENT_TARGET"] = "16.0";
        }
      }
    }

    // ── Extension targets ─────────────────────────────────────────────────────
    const newExtTargets = []; // collect for embedding step below

    for (const ext of EXTENSIONS) {
      if (!targetExists(proj, ext.name)) {
        const target = proj.addTarget(
          ext.name,
          "app_extension",
          ext.name, // subfolder (used for build settings like INFOPLIST_FILE)
          ext.bundleId
        );

        if (target) {
          // addTarget() creates the extension target with buildPhases: [] —
          // completely empty. Without Sources/Frameworks phases, addFileToTarget()
          // can't add the Swift file to any compilation phase, Xcode skips
          // compilation, and the .appex bundle has no binary → iOS rejects install.
          // Create them explicitly here before addFileToTarget() runs.
          proj.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
          proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
          proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);

          // addTarget() does NOT create a PBXGroup for the extension's sources.
          // Without an explicit group, the PBXFileReference has sourceTree="<group>"
          // but no parent group to anchor its path. Xcode then resolves it relative
          // to $(SRCROOT) directly → "Build input file cannot be found:
          // .../ios/AlbaDeviceActivityReport.swift" instead of
          // .../ios/AlbaDeviceActivityReport/AlbaDeviceActivityReport.swift.
          // Create the group explicitly so the path resolves correctly.
          const extGroupKey = createExtensionGroup(proj, ext.name);
          addFileToTarget(proj, ext.sourceFile, extGroupKey, target.uuid);

          // Read the provisioning profile UUID so we can use Manual signing.
          // EAS only installs the main app's profile; extension profiles are
          // installed by our withDangerousMod step into ~/Library/MobileDevice/
          // Provisioning Profiles/ so Xcode can locate them by UUID.
          const profileAbsPath = ext.profilePath
            ? path.resolve(config.modRequest.projectRoot, ext.profilePath)
            : null;
          const profileUUID = profileAbsPath
            ? getMobileProvisionUUID(profileAbsPath)
            : null;

          const extSettings = {
            SWIFT_VERSION: '"5.0"',
            IPHONEOS_DEPLOYMENT_TARGET: "16.0",
            PRODUCT_BUNDLE_IDENTIFIER: `"${ext.bundleId}"`,
            CODE_SIGN_ENTITLEMENTS: `"${ext.entitlements}"`,
            INFOPLIST_FILE: `"${ext.infoPlist}"`,
            SKIP_INSTALL: "YES",
            TARGETED_DEVICE_FAMILY: '"1,2"',
            ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: "NO",
            // Always use Manual signing for extension targets. Setting
            // CODE_SIGN_STYLE = Automatic while CODE_SIGN_IDENTITY = "iPhone
            // Distribution" causes Xcode to error: "conflicting provisioning
            // settings". Manual + iPhone Distribution is correct for all
            // distribution builds (production and ad-hoc).
            CODE_SIGN_STYLE: "Manual",
            CODE_SIGN_IDENTITY: '"iPhone Distribution"',
          };

          if (profileUUID) {
            extSettings.PROVISIONING_PROFILE = `"${profileUUID}"`;
            extSettings.PROVISIONING_PROFILE_SPECIFIER = `"${profileUUID}"`;
          }

          // 1. Try pbxproj (set if ios/ already existed from a prior build)
          // 2. Try ios.teamId from app.config.js
          // 3. Fall back to EAS-injected APPLE_TEAM_ID env var
          const inheritedTeam =
            getTeamId(proj, mainTarget) ||
            config.ios?.teamId ||
            process.env.APPLE_TEAM_ID ||
            "";
          if (inheritedTeam) extSettings.DEVELOPMENT_TEAM = inheritedTeam;
          applyBuildSettings(proj, target, extSettings);

          newExtTargets.push({ ...target, ext });

          // Add a Run Script build phase that syncs CFBundleVersion from the
          // main app Info.plist at Xcode build time. EAS (appVersionSource:
          // remote) writes the build number to ios/Alba/Info.plist AFTER pod
          // install, so a post_install hook reads the wrong value. By the time
          // Xcode starts building, EAS has already written the real number.
          addVersionSyncScriptPhase(proj, target);
        }
      }
    }

    // ── Add Poppins font resources to AlbaDeviceActivityReport ───────────────
    // Guard against duplicates by checking the Resources build phase directly
    // rather than just PBXFileReference existence. A file can have a reference
    // but not be in Copy Bundle Resources (e.g. after an incremental prebuild
    // that created the reference but skipped the phase entry). This check ensures
    // the font is actually built into the extension bundle.
    for (const ext of EXTENSIONS) {
      if (!ext.fontFiles) continue;
      const extUuid = getTargetUuidByName(proj, ext.name);
      if (!extUuid) continue;
      const extGroupKey =
        proj.findPBXGroupKey({ name: ext.name }) ||
        proj.findPBXGroupKey({ path: ext.name });
      if (!extGroupKey) continue;
      for (const fontFile of ext.fontFiles) {
        if (!fontInResourcesPhase(proj, fontFile, extUuid)) {
          addResourceToTarget(proj, fontFile, extGroupKey, extUuid);
        }
      }
    }

    // ── Remove auto-created "Copy Files" phases ───────────────────────────────
    // addTarget('app_extension') automatically creates a "Copy Files"
    // PBXCopyFilesBuildPhase (dstSubfolderSpec=13) in the main app target for
    // EACH extension. embedExtensionsInMainTarget() below creates ONE "Embed
    // App Extensions" phase covering all extensions. Having both causes Xcode
    // 16's build system to error: "Unexpected duplicate tasks" (copy + validate
    // running twice per .appex). Delete addTarget()'s auto-created phases here
    // so only our single "Embed App Extensions" phase remains.
    if (newExtTargets.length > 0) {
      const copyPhasesSection =
        proj.hash.project.objects["PBXCopyFilesBuildPhase"] || {};
      const mainNativeTarget =
        proj.hash.project.objects["PBXNativeTarget"]?.[mainTarget.uuid];
      if (mainNativeTarget) {
        mainNativeTarget.buildPhases = (mainNativeTarget.buildPhases || []).filter(
          (phaseRef) => {
            const phaseUuid =
              typeof phaseRef === "object" ? phaseRef.value : phaseRef;
            if (copyPhasesSection[`${phaseUuid}_comment`] === "Copy Files") {
              delete copyPhasesSection[phaseUuid];
              delete copyPhasesSection[`${phaseUuid}_comment`];
              return false; // remove from buildPhases
            }
            return true;
          }
        );
      }
    }

    // ── Embed extensions in main target ───────────────────────────────────────
    // CocoaPods detects host-extension relationships by scanning for a
    // PBXCopyFilesBuildPhase (dstSubfolderSpec=13) in the main app target whose
    // files reference the extension's productReference. This function creates
    // the "Embed App Extensions" phase satisfying that scan.
    // CRITICAL: pass 'app_extension' (string) NOT an options object to
    // addBuildPhase() — an object silently fails dstSubfolderSpec lookup,
    // leaving it undefined which Xcode maps to PrivateHeaders/ (wrong).
    if (mainTarget && newExtTargets.length > 0) {
      embedExtensionsInMainTarget(proj, mainTarget.uuid, newExtTargets);
    }

    return config;
  });

  // Step 5: Modify Podfile via withPodfile (a base mod).
  // withPodfile runs in plugin-registration order within the base-mod pipeline,
  // AFTER all earlier plugins' withPodfile mods (stripe, reanimated, …) have
  // already appended their post_install blocks. withDangerousMod runs BEFORE
  // base mods, so using it here caused the merge to happen too early — before
  // stripe etc. had added their blocks — leaving multiple hooks in the final file.
  config = withPodfile(config, (config) => {
    // modResults is the Podfile content as a string in Expo SDK 52+.
    let podfile = typeof config.modResults === "string"
      ? config.modResults
      : (config.modResults?.contents ?? "");

    // Ensure iOS 16.0 platform (FamilyControls requires it)
    podfile = podfile.replace(
      /^platform :ios,\s*['"][^'"]+['"]/m,
      "platform :ios, '16.0'"
    );

    // Add extension target stubs so CocoaPods knows about them.
    // Without these, CocoaPods creates a default "Copy Headers" build phase
    // for the unknown targets, which places the .appex bundles in PrivateHeaders/
    // instead of PlugIns/ and causes iOS to reject the installation.
    // `inherit! :none` prevents the extension from inheriting any pod dependencies.
    for (const ext of EXTENSIONS) {
      const marker = `target '${ext.name}'`;
      if (!podfile.includes(marker)) {
        podfile = podfile.trimEnd() + `\n\ntarget '${ext.name}' do\n  inherit! :none\nend\n`;
      }
    }

    // Fix for Xcode 14+: resource bundle targets are signed by default which
    // breaks builds. Multiple plugins (reanimated, stripe, …) each append
    // their own `post_install` block; CocoaPods rejects Podfiles with more
    // than one. Merge every post_install block into a single block and append
    // the CODE_SIGNING_ALLOWED fix.
    try {
      const allLines = podfile.split("\n");
      const piLines = allLines
        .map((l, i) => ({ i, l }))
        .filter(({ l }) => /post_install/.test(l))
        .map(({ i, l }) => `  line ${i + 1}: ${JSON.stringify(l)}`);
      process.stderr.write(`[withScreenTime] Podfile has ${allLines.length} lines. post_install occurrences:\n${piLines.join("\n") || "  (none)"}\n`);

      const before = (podfile.match(/^\s*post_install\s+do\s+\|/gm) || []).length;
      podfile = mergePostInstallHooks(podfile);
      const after = (podfile.match(/^\s*post_install\s+do\s+\|/gm) || []).length;
      process.stderr.write(`[withScreenTime] post_install hooks: ${before} -> ${after}\n`);
    } catch (e) {
      process.stderr.write(`[withScreenTime] Podfile post_install merge failed: ${e?.message || e}\n`);
    }

    if (typeof config.modResults === "string") {
      config.modResults = podfile;
    } else {
      config.modResults.contents = podfile;
    }
    return config;
  });

  // Step 6: Write extension support files to disk via withDangerousMod.
  // (Extension entitlements/Info.plist can't go through a base mod since they
  //  aren't standard Expo-managed files.)
  config = withDangerousMod(config, [
    "ios",
    (config) => {
      // ── Copy native sources into ios/ ─────────────────────────────────────
      // EAS Build clears ios/ via `prebuild --clean`. All custom Swift/ObjC
      // sources are stored in modules/<Dir>/ (outside ios/, never wiped) and
      // copied here unconditionally so Xcode can find them at build time.
      // This covers:
      //   modules/AlbaScreenTime/         → ios/AlbaScreenTime/
      //   modules/AlbaDeviceActivityExtension/ → ios/AlbaDeviceActivityExtension/
      //   modules/AlbaDeviceActivityReport/    → ios/AlbaDeviceActivityReport/
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectRoot = config.modRequest.projectRoot;
      const nativeModuleDirs = [
        "AlbaScreenTime",
        "AlbaDeviceActivityExtension",
        "AlbaDeviceActivityReport",
      ];
      for (const dirName of nativeModuleDirs) {
        const srcDir = path.join(projectRoot, "modules", dirName);
        const dstDir = path.join(iosRoot, dirName);
        if (fs.existsSync(srcDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
          for (const file of fs.readdirSync(srcDir)) {
            fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
          }
          process.stderr.write(`[withScreenTime] Copied ${dirName} sources to ios/${dirName}/\n`);
        } else {
          process.stderr.write(`[withScreenTime] WARNING: modules/${dirName}/ not found\n`);
        }
      }

      // ── Copy Poppins fonts into AlbaDeviceActivityReport extension ───────────
      // expo-font loads fonts as JS assets (not native iOS resources), so the
      // extension bundle cannot inherit them from the main app. Copy the needed
      // variants from assets/fonts/ so the extension can use Font.custom().
      const fontSrcDir = path.join(projectRoot, "assets", "fonts");
      const fontDstDir = path.join(iosRoot, "AlbaDeviceActivityReport");
      const reportExt = EXTENSIONS.find((e) => e.name === "AlbaDeviceActivityReport");
      for (const fontFile of reportExt?.fontFiles ?? []) {
        const src = path.join(fontSrcDir, fontFile);
        const dst = path.join(fontDstDir, fontFile);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          process.stderr.write(`[withScreenTime] Copied ${fontFile} to ios/AlbaDeviceActivityReport/\n`);
        } else {
          process.stderr.write(`[withScreenTime] WARNING: font not found: assets/fonts/${fontFile}\n`);
        }
      }

      // ── Patch bridging header for RCTBridgeModule ─────────────────────────
      // AlbaScreenTimeModule.swift uses RCTPromiseResolveBlock / RCTPromiseRejectBlock
      // (ObjC typedefs from <React/RCTBridgeModule.h>). Expo SDK 54 generates
      // ios/Alba/Alba-Bridging-Header.h but only imports ExpoModulesCore — it
      // does not import the React bridge module header. Without it, Swift sees
      // "cannot find type 'RCTPromiseResolveBlock' in scope".
      const bridgingHeaderPath = path.join(iosRoot, "Alba", "Alba-Bridging-Header.h");
      const rctImport = "#import <React/RCTBridgeModule.h>";
      if (fs.existsSync(bridgingHeaderPath)) {
        const existing = fs.readFileSync(bridgingHeaderPath, "utf8");
        if (!existing.includes("RCTBridgeModule.h")) {
          fs.writeFileSync(bridgingHeaderPath, existing.trimEnd() + "\n" + rctImport + "\n");
          process.stderr.write("[withScreenTime] Added RCTBridgeModule.h to Alba-Bridging-Header.h\n");
        }
      } else {
        // Bridging header doesn't exist yet — create it. withXcodeProject
        // ensures SWIFT_OBJC_BRIDGING_HEADER points here.
        fs.mkdirSync(path.join(iosRoot, "Alba"), { recursive: true });
        fs.writeFileSync(bridgingHeaderPath, rctImport + "\n");
        process.stderr.write("[withScreenTime] Created Alba-Bridging-Header.h with RCTBridgeModule.h\n");
      }

      // ── Recreate extension support files ──────────────────────────────────
      // EAS Build clears the entire ios/ directory during prebuild. We must
      // recreate the entitlements AND Info.plist files for both extension
      // targets here, unconditionally, so Xcode can find them at build time.
      // These are always overwritten — never skipped — to ensure fresh content.

      const APP_GROUP = "group.com.alba.app.screentime";
      const entitlementsPlist = (appGroup) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>${appGroup}</string>
    </array>
</dict>
</plist>`;

      const extFiles = [
        {
          dir: "AlbaDeviceActivityExtension",
          files: {
            "AlbaDeviceActivityExtension.entitlements": entitlementsPlist(APP_GROUP),
            "Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.deviceactivity.monitor-extension</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).AlbaDeviceActivityExtension</string>
    </dict>
</dict>
</plist>`,
          },
        },
        {
          dir: "AlbaDeviceActivityReport",
          files: {
            "AlbaDeviceActivityReport.entitlements": entitlementsPlist(APP_GROUP),
            "Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>UIAppFonts</key>
    <array>
        <string>Poppins-Regular.ttf</string>
        <string>Poppins-Bold.ttf</string>
        <string>Poppins-SemiBold.ttf</string>
    </array>
    <key>EXAppExtensionAttributes</key>
    <dict>
        <key>EXExtensionPointIdentifier</key>
        <string>com.apple.deviceactivityui.report-extension</string>
    </dict>
</dict>
</plist>`,
          },
        },
      ];

      for (const { dir, files } of extFiles) {
        const dirPath = path.join(iosRoot, dir);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        for (const [filename, content] of Object.entries(files)) {
          // Always write — never skip — so stale/missing files are fixed every run.
          fs.writeFileSync(path.join(dirPath, filename), content);
        }
      }

      // ── Patch expo-image ImageView.swift for Xcode 16.1 / iOS 18 SDK ────────
      // expo-image 55.x has an @available(iOS 26.0, *) function that references
      // DrawOnSymbolEffect / DrawOffSymbolEffect. These types only exist in the
      // iOS 26 SDK (Xcode 26+). Xcode 16.1 ships with the iOS 18 SDK, so these
      // types don't exist at compile time — even inside an @available guard.
      // @available prevents runtime calls but NOT compile-time type resolution,
      // so the compiler still errors with "cannot find X in scope".
      //
      // Fix: remove the iOS 26 call site and the entire applySymbolEffectiOS26
      // function. The iOS 17/18 symbol effects (wiggle, rotate, breathe, bounce,
      // pulse, etc.) are all in the iOS 18 SDK and compile correctly.
      //
      // This patch is scoped to @available(iOS 26.0, *) blocks only and will
      // become a no-op once the eas.json build image is updated to Xcode 26+.
      const imageViewPath = path.join(
        config.modRequest.projectRoot,
        "node_modules/expo-image/ios/ImageView.swift"
      );
      if (fs.existsSync(imageViewPath)) {
        let imageViewContent = fs.readFileSync(imageViewPath, "utf8");
        const imageViewOriginal = imageViewContent;

        // 1. Replace the call site in applySymbolEffectiOS18's default: case.
        imageViewContent = imageViewContent.replace(
          "      if #available(iOS 26.0, tvOS 26.0, *) {\n        applySymbolEffectiOS26(effect: effect, scope: scope, options: options)\n      }",
          "      break"
        );

        // 2. Remove the entire applySymbolEffectiOS26 function.
        //    It ends at the first \n  } (2-space indent) after its signature — its
        //    own closing brace. Inner scopes use 4+ space indentation so the regex
        //    is unambiguous.
        imageViewContent = imageViewContent.replace(
          /\n\n  @available\(iOS 26\.0, tvOS 26\.0, \*\)\n  private func applySymbolEffectiOS26[\s\S]*?\n  \}/,
          ""
        );

        if (imageViewContent !== imageViewOriginal) {
          fs.writeFileSync(imageViewPath, imageViewContent);
          process.stderr.write("[withScreenTime] Patched expo-image/ios/ImageView.swift: removed iOS 26 symbol effects (not in Xcode 16.1 SDK)\n");
        } else {
          process.stderr.write("[withScreenTime] expo-image/ios/ImageView.swift: no iOS 26 patch needed\n");
        }
      }

      // ── Install extension provisioning profiles ────────────────────────────
      // EAS only installs the main app's provisioning profile. Extension profiles
      // must be copied to ~/Library/MobileDevice/Provisioning Profiles/ (named by
      // UUID) so Xcode can find them when CODE_SIGN_STYLE = Manual.
      const provProfilesDir = path.join(
        require("os").homedir(),
        "Library",
        "MobileDevice",
        "Provisioning Profiles"
      );
      fs.mkdirSync(provProfilesDir, { recursive: true });

      for (const ext of EXTENSIONS) {
        if (!ext.profilePath) continue;
        const srcPath = path.resolve(projectRoot, ext.profilePath);
        if (!fs.existsSync(srcPath)) {
          process.stderr.write(
            `[withScreenTime] Warning: profile not found at ${srcPath}\n`
          );
          continue;
        }
        const uuid = getMobileProvisionUUID(srcPath);
        if (!uuid) {
          process.stderr.write(
            `[withScreenTime] Warning: could not read UUID from ${srcPath}\n`
          );
          continue;
        }
        const destPath = path.join(provProfilesDir, `${uuid}.mobileprovision`);
        fs.copyFileSync(srcPath, destPath);
        process.stderr.write(
          `[withScreenTime] Installed profile ${ext.name} (${uuid})\n`
        );
      }

      // ── Patch IPHONEOS_DEPLOYMENT_TARGET in pbxproj ──────────────────────
      // withXcodeProject sets this value in-memory, but another mod (Expo's
      // own finalizer or a subsequent plugin) may reset it. withDangerousMod
      // runs AFTER all base mods have written their files to disk, so patching
      // the serialized .pbxproj here is a guaranteed failsafe.
      // FamilyControls / DeviceActivity require iOS 16.0+.
      const pbxprojPath = path.join(
        iosRoot, "Alba.xcodeproj", "project.pbxproj"
      );
      if (fs.existsSync(pbxprojPath)) {
        let pbxproj = fs.readFileSync(pbxprojPath, "utf8");
        let patchCount = 0;
        const patchedPbxproj = pbxproj.replace(
          /IPHONEOS_DEPLOYMENT_TARGET = (\d+\.\d+);/g,
          (match, ver) => {
            if (parseFloat(ver) < 16.0) {
              patchCount++;
              return "IPHONEOS_DEPLOYMENT_TARGET = 16.0;";
            }
            return match;
          }
        );
        if (patchCount > 0) {
          fs.writeFileSync(pbxprojPath, patchedPbxproj);
          process.stderr.write(
            `[withScreenTime] Patched ${patchCount} IPHONEOS_DEPLOYMENT_TARGET → 16.0 in project.pbxproj\n`
          );
        } else {
          process.stderr.write(
            "[withScreenTime] project.pbxproj: all IPHONEOS_DEPLOYMENT_TARGET already >= 16.0\n"
          );
        }
      }

      return config;
    },
  ]);

  return config;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if a native target with this name already exists. */
function targetExists(proj, name) {
  const targets = proj.hash.project.objects["PBXNativeTarget"] || {};
  return Object.values(targets).some(
    (t) => typeof t === "object" && t.name === name
  );
}

/** Returns true if a file reference with this filename already exists. */
function fileExists(proj, filename) {
  const refs = proj.hash.project.objects["PBXFileReference"] || {};
  return Object.values(refs).some(
    (f) => typeof f === "object" && f.path && String(f.path).includes(filename)
  );
}

/**
 * Returns true if a file is already listed in the PBXResourcesBuildPhase of
 * the given target. Used instead of fileExists() for font resources so that
 * a PBXFileReference that exists but was never added to Copy Bundle Resources
 * (e.g. from a failed incremental prebuild) still gets correctly added.
 */
function fontInResourcesPhase(proj, filename, targetUuid) {
  const objects = proj.hash.project.objects;
  const target = (objects["PBXNativeTarget"] || {})[targetUuid];
  if (!target) return false;
  const resourcesPhases = objects["PBXResourcesBuildPhase"] || {};
  const buildFiles = objects["PBXBuildFile"] || {};
  const refs = objects["PBXFileReference"] || {};
  for (const phaseRef of target.buildPhases || []) {
    const phaseUuid = typeof phaseRef === "object" ? phaseRef.value : phaseRef;
    const phase = resourcesPhases[phaseUuid];
    if (!phase) continue;
    for (const fileRef of phase.files || []) {
      const bfUuid = typeof fileRef === "object" ? fileRef.value : fileRef;
      const bf = buildFiles[bfUuid];
      if (!bf) continue;
      const ref = refs[bf.fileRef];
      if (ref && ref.path && String(ref.path).includes(filename)) return true;
    }
  }
  return false;
}

/**
 * Low-level alternative to addSourceFile that directly writes the four
 * pbxproj entries needed to compile a file, without touching addPluginFile.
 *
 * Sections written:
 *   PBXFileReference   — declares the file on disk
 *   PBXGroup.children  — adds it to the Xcode navigator group
 *   PBXBuildFile       — wraps the reference for a build phase
 *   PBXSourcesBuildPhase.files — registers it for compilation
 */
function addFileToTarget(proj, filename, groupKey, targetUuid) {
  const fileRef = proj.generateUuid();
  const buildFileUuid = proj.generateUuid();
  const objects = proj.hash.project.objects;

  const lastKnownFileType = filename.endsWith(".swift")
    ? "sourcecode.swift"
    : filename.endsWith(".m")
    ? "sourcecode.c.objc"
    : "sourcecode.c.h";

  // 1. PBXFileReference
  const fileRefs = objects["PBXFileReference"] || {};
  fileRefs[fileRef] = {
    isa: "PBXFileReference",
    lastKnownFileType: lastKnownFileType,
    path: `"${filename}"`,
    sourceTree: '"<group>"',
  };
  fileRefs[`${fileRef}_comment`] = filename;
  objects["PBXFileReference"] = fileRefs;

  // 2. Add the file reference to its navigator group
  const groups = objects["PBXGroup"] || {};
  if (groups[groupKey] && Array.isArray(groups[groupKey].children)) {
    groups[groupKey].children.push({ value: fileRef, comment: filename });
  }

  // 3. PBXBuildFile
  const buildFiles = objects["PBXBuildFile"] || {};
  buildFiles[buildFileUuid] = {
    isa: "PBXBuildFile",
    fileRef: fileRef,
    fileRef_comment: filename,
  };
  buildFiles[`${buildFileUuid}_comment`] = `${filename} in Sources`;
  objects["PBXBuildFile"] = buildFiles;

  // 4. Append to the Sources build phase for the target
  const nativeTargets = objects["PBXNativeTarget"] || {};
  const target = nativeTargets[targetUuid];
  if (!target) return;

  const sourcesPhases =
    proj.hash.project.objects["PBXSourcesBuildPhase"] || {};
  for (const phaseRef of target.buildPhases || []) {
    const phaseUuid =
      typeof phaseRef === "object" ? phaseRef.value : phaseRef;
    if (sourcesPhases[phaseUuid]) {
      // Guard against duplicate Sources entries (Xcode 16 "unexpected duplicate
      // tasks" error). Skip if this file is already listed in the phase.
      const phase = sourcesPhases[phaseUuid];
      const alreadyListed = (phase.files || []).some(
        (f) => f.comment && f.comment.includes(filename)
      );
      if (!alreadyListed) {
        phase.files.push({
          value: buildFileUuid,
          comment: `${filename} in Sources`,
        });
      }
      break;
    }
  }
}

/** Returns the PBXNativeTarget UUID for a target with the given name, or null. */
function getTargetUuidByName(proj, name) {
  const targets = proj.hash.project.objects["PBXNativeTarget"] || {};
  for (const [uuid, t] of Object.entries(targets)) {
    if (typeof t === "object" && (t.name === name || t.name === `"${name}"`)) {
      return uuid;
    }
  }
  return null;
}

/**
 * Adds a resource file (e.g. .ttf) to a target's PBXResourcesBuildPhase.
 * Mirrors addFileToTarget but targets the Resources phase instead of Sources.
 */
function addResourceToTarget(proj, filename, groupKey, targetUuid) {
  const fileRef = proj.generateUuid();
  const buildFileUuid = proj.generateUuid();
  const objects = proj.hash.project.objects;

  // 1. PBXFileReference
  const fileRefs = objects["PBXFileReference"] || {};
  fileRefs[fileRef] = {
    isa: "PBXFileReference",
    lastKnownFileType: "file",
    path: `"${filename}"`,
    sourceTree: '"<group>"',
  };
  fileRefs[`${fileRef}_comment`] = filename;
  objects["PBXFileReference"] = fileRefs;

  // 2. Add to navigator group
  const groups = objects["PBXGroup"] || {};
  if (groups[groupKey] && Array.isArray(groups[groupKey].children)) {
    groups[groupKey].children.push({ value: fileRef, comment: filename });
  }

  // 3. PBXBuildFile
  const buildFiles = objects["PBXBuildFile"] || {};
  buildFiles[buildFileUuid] = {
    isa: "PBXBuildFile",
    fileRef: fileRef,
    fileRef_comment: filename,
  };
  buildFiles[`${buildFileUuid}_comment`] = `${filename} in Resources`;
  objects["PBXBuildFile"] = buildFiles;

  // 4. Append to the Resources build phase for the target
  const nativeTargets = objects["PBXNativeTarget"] || {};
  const target = nativeTargets[targetUuid];
  if (!target) return;

  const resourcesPhases = objects["PBXResourcesBuildPhase"] || {};
  for (const phaseRef of target.buildPhases || []) {
    const phaseUuid = typeof phaseRef === "object" ? phaseRef.value : phaseRef;
    if (resourcesPhases[phaseUuid]) {
      const phase = resourcesPhases[phaseUuid];
      const alreadyListed = (phase.files || []).some(
        (f) => f.comment && f.comment.includes(filename)
      );
      if (!alreadyListed) {
        phase.files.push({
          value: buildFileUuid,
          comment: `${filename} in Resources`,
        });
      }
      break;
    }
  }
}

/**
 * Returns the DEVELOPMENT_TEAM value from any build configuration of the
 * given target, or an empty string if not set. Used to propagate the team
 * from the main target to extension targets so Xcode can sign them.
 */
function getTeamId(proj, target) {
  const objects = proj.hash.project.objects;
  const configLists = objects["XCConfigurationList"] || {};
  const buildConfigs = objects["XCBuildConfiguration"] || {};
  // getFirstTarget() returns the raw pbxNativeTarget object directly,
  // while addTarget() returns { uuid, pbxNativeTarget }. Handle both.
  const nativeTarget = target?.pbxNativeTarget ?? target;
  const listUUID = nativeTarget?.buildConfigurationList;
  const list = configLists[listUUID];
  if (!list) return "";
  for (const ref of list.buildConfigurations || []) {
    const uuid = typeof ref === "object" ? ref.value : ref;
    const cfg = buildConfigs[uuid];
    if (cfg?.buildSettings?.DEVELOPMENT_TEAM) {
      return cfg.buildSettings.DEVELOPMENT_TEAM;
    }
  }
  return "";
}

/**
 * Applies build settings to every XCBuildConfiguration in the target's
 * configuration list (covers both Debug and Release).
 */
function applyBuildSettings(proj, target, settings) {
  const objects = proj.hash.project.objects;
  const configLists = objects["XCConfigurationList"] || {};
  const buildConfigs = objects["XCBuildConfiguration"] || {};

  const listUUID = target.pbxNativeTarget.buildConfigurationList;
  const list = configLists[listUUID];
  if (!list) return;

  for (const ref of list.buildConfigurations || []) {
    const uuid = typeof ref === "object" ? ref.value : ref;
    const cfg = buildConfigs[uuid];
    if (cfg && cfg.buildSettings) {
      Object.assign(cfg.buildSettings, settings);
    }
  }
}

/**
 * Adds an "Embed App Extensions" PBXCopyFilesBuildPhase to the main target
 * and registers each extension as a PBXTargetDependency. CocoaPods detects
 * the host-extension relationship by scanning for a PBXCopyFilesBuildPhase
 * with dstSubfolderSpec=13 in the main app target whose files reference the
 * extension's productReference. Without this function, pod install fails with
 * "Unable to find host target(s)".
 *
 * CRITICAL: the 5th argument to addBuildPhase() must be the string
 * 'app_extension' (NOT an options object). pbxCopyFilesBuildPhaseObj() uses
 * it as a key into DESTINATION_BY_TARGETTYPE; an object silently fails and
 * leaves dstSubfolderSpec=undefined, which Xcode maps to PrivateHeaders/.
 * Passing 'app_extension' correctly sets dstSubfolderSpec=13 (PlugIns/).
 *
 * addTarget() already creates a "Copy Files" phase (dstSubfolderSpec=13) for
 * the same purpose, so the net result is two phases both copying to PlugIns/.
 * The duplicate is harmless — the second copy overwrites the first in place.
 */
function embedExtensionsInMainTarget(proj, mainTargetUuid, extTargets) {
  const objects = proj.hash.project.objects;
  const nativeTargets = objects["PBXNativeTarget"] || {};
  const mainTarget = nativeTargets[mainTargetUuid];
  if (!mainTarget) return;

  // Ensure sections exist before addTargetDependency() runs (it checks and
  // silently skips if PBXContainerItemProxy / PBXTargetDependency are missing).
  objects["PBXBuildFile"] = objects["PBXBuildFile"] || {};
  objects["PBXTargetDependency"] = objects["PBXTargetDependency"] || {};
  objects["PBXContainerItemProxy"] = objects["PBXContainerItemProxy"] || {};

  // NSExtensions → PlugIns/ (dstSubfolderSpec=13, via 'app_extension')
  // EXExtensions → Extensions/ (dstSubfolderSpec=1, dstPath="Extensions")
  const nsExtTargets = extTargets.filter((t) => !t.ext?.isEXExtension);
  const exExtTargets = extTargets.filter((t) => t.ext?.isEXExtension);

  // ── PlugIns/ phase for NSExtensions ───────────────────────────────────────
  const phaseResult = proj.addBuildPhase(
    [],
    "PBXCopyFilesBuildPhase",
    "Embed App Extensions",
    mainTargetUuid,
    "app_extension"
  );
  const copyPhaseUuid = phaseResult?.uuid;
  const copyPhaseFiles =
    objects["PBXCopyFilesBuildPhase"]?.[copyPhaseUuid]?.files;

  // ── Extensions/ phase for EXExtensions ────────────────────────────────────
  let exPhaseUuid = null;
  let exPhaseFiles = null;
  if (exExtTargets.length > 0) {
    exPhaseUuid = proj.generateUuid();
    exPhaseFiles = [];
    objects["PBXCopyFilesBuildPhase"][exPhaseUuid] = {
      isa: "PBXCopyFilesBuildPhase",
      buildActionMask: "2147483647",
      dstPath: '"Extensions"',
      dstSubfolderSpec: "1",
      files: exPhaseFiles,
      name: '"Embed ExtensionKit Extensions"',
      runOnlyForDeploymentPostprocessing: "0",
    };
    objects["PBXCopyFilesBuildPhase"][`${exPhaseUuid}_comment`] =
      "Embed ExtensionKit Extensions";
    mainTarget.buildPhases.push({
      value: exPhaseUuid,
      comment: "Embed ExtensionKit Extensions",
    });
  }

  for (const extTarget of extTargets) {
    const extNative = extTarget.pbxNativeTarget;
    const extUuid = extTarget.uuid;
    const extName = stripPbxString(extNative.name);
    const productRef = extNative.productReference;
    const isEX = extTarget.ext?.isEXExtension;
    const phaseName = isEX
      ? "Embed ExtensionKit Extensions"
      : "Embed App Extensions";
    const targetPhaseUuid = isEX ? exPhaseUuid : copyPhaseUuid;
    const targetPhaseFiles = isEX ? exPhaseFiles : copyPhaseFiles;

    if (productRef && targetPhaseUuid && targetPhaseFiles) {
      const bfUuid = proj.generateUuid();
      objects["PBXBuildFile"][bfUuid] = {
        isa: "PBXBuildFile",
        fileRef: productRef,
        fileRef_comment: `${extName}.appex`,
        settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
      };
      objects["PBXBuildFile"][`${bfUuid}_comment`] =
        `${extName}.appex in ${phaseName}`;
      targetPhaseFiles.push({
        value: bfUuid,
        comment: `${extName}.appex in ${phaseName}`,
      });
    }

    // Target dependency so Xcode builds the extension before the main app.
    const proxyUuid = proj.generateUuid();
    const depUuid = proj.generateUuid();
    objects["PBXContainerItemProxy"][proxyUuid] = {
      isa: "PBXContainerItemProxy",
      containerPortal: proj.hash.project.rootObject,
      containerPortal_comment: "Project object",
      proxyType: 1,
      remoteGlobalIDString: extUuid,
      remoteInfo: extName,
    };
    objects["PBXTargetDependency"][depUuid] = {
      isa: "PBXTargetDependency",
      target: extUuid,
      target_comment: extName,
      targetProxy: proxyUuid,
      targetProxy_comment: "PBXContainerItemProxy",
    };
    mainTarget.dependencies = mainTarget.dependencies || [];
    mainTarget.dependencies.push({ value: depUuid, comment: "PBXTargetDependency" });
  }
  // addBuildPhase already pushed the phase UUID into mainTarget.buildPhases.
}

/** Strip surrounding pbxproj quote chars that xcode npm stores on some string values. */
function stripPbxString(s) {
  const str = String(s || "");
  return str.startsWith('"') && str.endsWith('"') && str.length >= 2
    ? str.slice(1, -1)
    : str;
}

/**
 * Creates a PBXGroup for an extension target and adds it to the root project
 * group (the Xcode navigator's top level). Returns the new group's UUID.
 *
 * WHY this is needed:
 *   addTarget() creates a PBXNativeTarget but NO PBXGroup for the extension's
 *   source files. A PBXFileReference with sourceTree="<group>" resolves its
 *   path relative to its parent group. Without a parent group, Xcode falls back
 *   to resolving relative to $(SRCROOT) — so "AlbaDeviceActivityReport.swift"
 *   maps to ios/AlbaDeviceActivityReport.swift (wrong) instead of
 *   ios/AlbaDeviceActivityReport/AlbaDeviceActivityReport.swift (correct).
 *
 * The group is given both `name` and `path` equal to extName so that:
 *   - findPBXGroupKey({ name }) and findPBXGroupKey({ path }) both work
 *   - Files inside the group resolve to $(SRCROOT)/<extName>/<file>
 */
function createExtensionGroup(proj, extName) {
  const objects = proj.hash.project.objects;

  // Reuse if already present (idempotency for non-clean builds).
  const existing =
    proj.findPBXGroupKey({ name: extName }) ||
    proj.findPBXGroupKey({ path: extName });
  if (existing) return existing;

  const groupUuid = proj.generateUuid();
  objects["PBXGroup"] = objects["PBXGroup"] || {};
  objects["PBXGroup"][groupUuid] = {
    isa: "PBXGroup",
    children: [],
    name: `"${extName}"`,
    path: `"${extName}"`,
    sourceTree: '"<group>"',
  };
  objects["PBXGroup"][`${groupUuid}_comment`] = extName;

  // Add to the root project group so the folder appears in the Xcode navigator.
  // proj.hash.project.rootObject is the UUID of the PBXProject entry.
  const rootProjectUuid = proj.hash.project.rootObject;
  const rootGroupUuid =
    objects["PBXProject"]?.[rootProjectUuid]?.mainGroup;
  if (rootGroupUuid) {
    const rootGroup = objects["PBXGroup"][rootGroupUuid];
    if (rootGroup && Array.isArray(rootGroup.children)) {
      rootGroup.children.push({ value: groupUuid, comment: extName });
    }
  }

  return groupUuid;
}

/**
 * Adds a PBXShellScriptBuildPhase to the extension target that copies
 * CFBundleVersion and CFBundleShortVersionString from the main app's
 * Info.plist into the extension's source Info.plist at Xcode build time.
 *
 * WHY this is needed:
 *   EAS Build (appVersionSource: "remote") writes the build number directly
 *   to ios/Alba/Info.plist AFTER pod install completes. So any post_install
 *   hook that tries to read the version reads the prebuild template value
 *   ($(CURRENT_PROJECT_VERSION)) and not the real build number. By the time
 *   Xcode starts building, EAS has written the real value, so a Run Script
 *   phase can read it reliably.
 *
 *   The script declares $(SRCROOT)/Alba/Info.plist as an INPUT file and
 *   $(SRCROOT)/$(INFOPLIST_FILE) as an OUTPUT file, letting Xcode's build
 *   system schedule it before ProcessInfoPlistFile processes the extension plist.
 *   The phase is also inserted at position 0 in buildPhases as a belt-and-
 *   suspenders measure for Xcode's implicit task scheduling.
 */
function addVersionSyncScriptPhase(proj, extTarget) {
  const scriptLines = [
    "#!/bin/sh",
    "# Sync CFBundleVersion from the main app Info.plist at Xcode build time.",
    "# EAS (appVersionSource: remote) writes the build number AFTER pod install,",
    "# so post_install hooks see the wrong value. This script runs during the",
    "# Xcode build when EAS has already written the correct number.",
    'MAIN_PLIST="${SRCROOT}/Alba/Info.plist"',
    'EXT_PLIST="${SRCROOT}/${INFOPLIST_FILE}"',
    'if [ ! -f "$MAIN_PLIST" ] || [ ! -f "$EXT_PLIST" ]; then exit 0; fi',
    // Single quotes inside the PlistBuddy -c arg; double-quoted $MAIN_PLIST.
    // The surrounding double quotes in the JS string will be escaped by
    // pbxShellScriptBuildPhaseObj before storing in the pbxproj.
    "BUILD_VER=$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' \"$MAIN_PLIST\" 2>/dev/null | tr -d '[:space:]')",
    "MKT_VER=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' \"$MAIN_PLIST\" 2>/dev/null | tr -d '[:space:]')",
    "# Only write when BUILD_VER is a pure integer (EAS has set a real build number,",
    "# not a variable reference like $(CURRENT_PROJECT_VERSION)).",
    "if echo \"$BUILD_VER\" | grep -qE '^[0-9]+$'; then",
    "  /usr/libexec/PlistBuddy -c \"Set :CFBundleVersion $BUILD_VER\" \"$EXT_PLIST\"",
    "  /usr/libexec/PlistBuddy -c \"Set :CFBundleShortVersionString $MKT_VER\" \"$EXT_PLIST\"",
    "fi",
  ];
  const script = scriptLines.join("\n");
  const phaseName = "Sync CFBundleVersion from parent app";

  // addBuildPhase with PBXShellScriptBuildPhase passes optionsOrFolderType
  // directly to pbxShellScriptBuildPhaseObj(obj, options, phaseName).
  // That function wraps shellScript in quotes and escapes internal double quotes,
  // stores inputPaths/outputPaths as plain JS arrays.
  const phaseResult = proj.addBuildPhase(
    [],
    "PBXShellScriptBuildPhase",
    phaseName,
    extTarget.uuid,
    {
      inputPaths: ['"$(SRCROOT)/Alba/Info.plist"'],
      outputPaths: ['"$(SRCROOT)/$(INFOPLIST_FILE)"'],
      shellPath: "/bin/sh",
      shellScript: script,
    }
  );

  if (!phaseResult?.uuid) return;

  const objects = proj.hash.project.objects;

  // Add inputFileListPaths / outputFileListPaths to silence Xcode warnings.
  const scriptPhase = objects["PBXShellScriptBuildPhase"]?.[phaseResult.uuid];
  if (scriptPhase) {
    scriptPhase.inputFileListPaths = [];
    scriptPhase.outputFileListPaths = [];
    scriptPhase.showEnvVarsInLog = 0;
  }

  // Move the script phase to the front of buildPhases so it runs before
  // ProcessInfoPlistFile even when the build system's file-dependency graph
  // doesn't explicitly schedule it (implicit tasks may not honor user script
  // output files as dependencies).
  const nativeTarget = objects["PBXNativeTarget"]?.[extTarget.uuid];
  if (nativeTarget?.buildPhases?.length > 1) {
    const idx = nativeTarget.buildPhases.findIndex((ref) => {
      const uuid = typeof ref === "object" ? ref.value : ref;
      return uuid === phaseResult.uuid;
    });
    if (idx > 0) {
      const [phaseRef] = nativeTarget.buildPhases.splice(idx, 1);
      nativeTarget.buildPhases.unshift(phaseRef);
    }
  }
}

/**
 * Merges all `post_install do |installer| ... end` blocks found in the
 * Podfile into a single block IN PLACE, then injects CODE_SIGNING_ALLOWED = NO.
 *
 * Critically, the first block is modified at its original position rather than
 * moved to column 0. The Expo SDK 54 / RN 0.81 Podfile template places the
 * post_install block with 2-space indentation inside `target 'Alba' do ... end`.
 * That block is a Ruby closure capturing variables (e.g. `config`) from the
 * enclosing scope. Moving it to column 0 breaks that scope and causes:
 *   undefined local variable or method 'config'
 *
 * Strategy:
 *   1. Parse all post_install blocks, recording line ranges.
 *   2. Keep the first block in place; inject extra bodies + SIGNING_FIX just
 *      before its closing `end` line.
 *   3. Delete lines belonging to extra blocks (reverse order to keep indices valid).
 */
function mergePostInstallHooks(podfile) {
  const SIGNING_FIX = [
    "  installer.pods_project.targets.each do |target|",
    "    target.build_configurations.each do |config|",
    "      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'",
    // Force Swift 5 language mode for all pods. Xcode 16 / Swift 6 treats
    // expo-image's ContentPosition.swift static property as a concurrency ERROR.
    // Swift 5 mode downgrades it to a warning. SWIFT_STRICT_CONCURRENCY alone
    // is insufficient when derived data is cached with Swift 6 object files.
    "      config.build_settings['SWIFT_VERSION'] = '5.0'",
    "      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'",
    "    end",
    "  end",
  ].join("\n");

  const lines = podfile.split("\n");

  // --- Pass 1: locate all post_install blocks ---
  // Each entry: { openIdx, closeIdx, indent, body }
  const blocks = [];
  let inBlock = false;
  let blockIndent = "";
  let blockOpenIdx = -1;
  let bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trimEnd();

    if (!inBlock) {
      const openMatch = /^(\s*)post_install\s+do\s+\|[^|]+\|/.exec(trimmedLine);
      if (openMatch) {
        inBlock = true;
        blockIndent = openMatch[1];
        blockOpenIdx = i;
        bodyLines = [];
        continue;
      }
    }

    if (inBlock) {
      const closeRe = new RegExp(`^${blockIndent}end\\b`);
      if (closeRe.test(trimmedLine)) {
        blocks.push({
          openIdx: blockOpenIdx,
          closeIdx: i,
          indent: blockIndent,
          body: bodyLines.join("\n").trimEnd(),
        });
        inBlock = false;
        blockIndent = "";
        blockOpenIdx = -1;
        bodyLines = [];
      } else {
        bodyLines.push(lines[i]);
      }
      continue;
    }
  }

  // --- No blocks found: append one ---
  if (blocks.length === 0) {
    if (podfile.includes("CODE_SIGNING_ALLOWED")) return podfile;
    return (
      podfile.trimEnd() +
      "\n\npost_install do |installer|\n" +
      SIGNING_FIX +
      "\nend\n"
    );
  }

  // --- Collect extra bodies from blocks[1..] ---
  const extraBodies = blocks.slice(1).map((b) => b.body);
  const alreadyFixed =
    blocks[0].body.includes("CODE_SIGNING_ALLOWED") ||
    extraBodies.some((b) => b.includes("CODE_SIGNING_ALLOWED"));
  if (!alreadyFixed) extraBodies.push(SIGNING_FIX);

  // --- Modify lines in place ---
  const result = lines.slice(); // shallow copy

  // 2a. Remove extra blocks (process in reverse order to keep indices stable)
  for (let b = blocks.length - 1; b >= 1; b--) {
    result.splice(blocks[b].openIdx, blocks[b].closeIdx - blocks[b].openIdx + 1);
  }

  // 2b. Recalculate first block's closeIdx after deletions above.
  //     Each deletion of N lines before closeIdx shifts it by -N.
  let firstCloseIdx = blocks[0].closeIdx;
  for (let b = 1; b < blocks.length; b++) {
    if (blocks[b].openIdx < blocks[0].closeIdx) {
      firstCloseIdx -= (blocks[b].closeIdx - blocks[b].openIdx + 1);
    }
  }

  // 2c. Inject extra bodies just before the first block's closing `end`.
  if (extraBodies.length > 0) {
    const indent = blocks[0].indent;
    const injected = extraBodies.join("\n") + "\n";
    // Split injected content into lines and insert before closing `end`
    const injectedLines = injected.split("\n");
    // Remove trailing empty string from split if present
    if (injectedLines[injectedLines.length - 1] === "") injectedLines.pop();
    result.splice(firstCloseIdx, 0, ...injectedLines);
  }

  return result.join("\n");
}
