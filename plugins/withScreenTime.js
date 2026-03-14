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
    profilePath: "certs/AlbaDeviceActivityExtension.mobileprovision",
  },
  {
    name: "AlbaDeviceActivityReport",
    bundleId: "com.albaapp.alba.AlbaDeviceActivityReport",
    sourceFile: "AlbaDeviceActivityReport.swift",
    entitlements:
      "AlbaDeviceActivityReport/AlbaDeviceActivityReport.entitlements",
    infoPlist: "AlbaDeviceActivityReport/Info.plist",
    profilePath: "certs/AlbaDeviceActivityReport.mobileprovision",
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
    }

    // ── Extension targets ─────────────────────────────────────────────────────
    const newExtTargets = []; // collect for embedding step below

    for (const ext of EXTENSIONS) {
      if (!targetExists(proj, ext.name)) {
        const target = proj.addTarget(
          ext.name,
          "app_extension",
          ext.name, // subfolder — addTarget creates a PBXGroup with this path
          ext.bundleId
        );

        if (target) {
          const groupKey = proj.findPBXGroupKey({ name: ext.name });
          if (groupKey) {
            addFileToTarget(proj, ext.sourceFile, groupKey, target.uuid);
          }

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
            CODE_SIGN_STYLE: profileUUID ? "Manual" : "Automatic",
            // Ad-hoc profiles require a Distribution certificate. Debug builds
            // default to "iPhone Developer" which causes "No signing certificate
            // iOS Development found" when only a Distribution cert is available.
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

          newExtTargets.push(target);
        }
      }
    }

    // ── Embed extensions in main target ───────────────────────────────────────
    // CocoaPods detects host-extension relationships via PBXCopyFilesBuildPhase
    // (dstSubfolderSpec=13, the PlugIns folder). Without this, pod install fails
    // with "Unable to find host target(s)".
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
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.deviceactivity.monitor-extension</string>
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
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.deviceactivity.ui-extension</string>
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
 * Adds a "Embed App Extensions" PBXCopyFilesBuildPhase to the main target
 * and registers each extension as a PBXTargetDependency. This is required so
 * CocoaPods can detect the host-extension relationship and so Xcode embeds
 * the .appex bundles in the final .ipa.
 *
 * Uses proj.addBuildPhase() instead of manual object construction.
 * Manual construction of PBXCopyFilesBuildPhase produces serialization formats
 * (e.g. dstPath with embedded quote chars) that some xcode npm versions write
 * as `KEY = ;` — an empty value that causes the pbxproj parser to throw
 * "Expected '(' but ';' found", breaking withIosEntitlementsBaseMod.
 */
function embedExtensionsInMainTarget(proj, mainTargetUuid, extTargets) {
  const objects = proj.hash.project.objects;
  const nativeTargets = objects["PBXNativeTarget"] || {};
  const mainTarget = nativeTargets[mainTargetUuid];
  if (!mainTarget) return;

  // Let the xcode library create the phase so it handles serialization correctly.
  // addBuildPhase also automatically pushes the phase into mainTarget.buildPhases.
  const phaseResult = proj.addBuildPhase(
    [],
    "PBXCopyFilesBuildPhase",
    "Embed App Extensions",
    mainTargetUuid,
    { dstSubfolderSpec: 13, dstPath: "" }
  );
  const copyPhaseUuid = phaseResult?.uuid;
  const copyPhaseFiles =
    objects["PBXCopyFilesBuildPhase"]?.[copyPhaseUuid]?.files;

  objects["PBXBuildFile"] = objects["PBXBuildFile"] || {};
  objects["PBXTargetDependency"] = objects["PBXTargetDependency"] || {};
  objects["PBXContainerItemProxy"] = objects["PBXContainerItemProxy"] || {};

  for (const extTarget of extTargets) {
    const extNative = extTarget.pbxNativeTarget;
    const extUuid = extTarget.uuid;
    // xcode npm may store names with surrounding pbxproj quote chars — strip them.
    const extName = stripPbxString(extNative.name);
    const productRef = extNative.productReference;

    if (productRef && copyPhaseUuid && copyPhaseFiles) {
      // Build file for the .appex product (no ATTRIBUTES — avoids duplicate
      // code-sign tasks in Xcode 26's stricter build system validation)
      const bfUuid = proj.generateUuid();
      objects["PBXBuildFile"][bfUuid] = {
        isa: "PBXBuildFile",
        fileRef: productRef,
        fileRef_comment: `${extName}.appex`,
      };
      objects["PBXBuildFile"][`${bfUuid}_comment`] =
        `${extName}.appex in Embed App Extensions`;
      copyPhaseFiles.push({
        value: bfUuid,
        comment: `${extName}.appex in Embed App Extensions`,
      });
    }

    // Target dependency so Xcode builds the extension with the main app
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
  // Note: addBuildPhase already added the phase UUID to mainTarget.buildPhases.
}

/** Strip surrounding pbxproj quote chars that xcode npm stores on some string values. */
function stripPbxString(s) {
  const str = String(s || "");
  return str.startsWith('"') && str.endsWith('"') && str.length >= 2
    ? str.slice(1, -1)
    : str;
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
