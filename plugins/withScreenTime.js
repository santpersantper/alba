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

const { withXcodeProject, withDangerousMod } = require("@expo/config-plugins");
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
  },
  {
    name: "AlbaDeviceActivityReport",
    bundleId: "com.albaapp.alba.AlbaDeviceActivityReport",
    sourceFile: "AlbaDeviceActivityReport.swift",
    entitlements:
      "AlbaDeviceActivityReport/AlbaDeviceActivityReport.entitlements",
    infoPlist: "AlbaDeviceActivityReport/Info.plist",
  },
];

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

          applyBuildSettings(proj, target, {
            SWIFT_VERSION: '"5.0"',
            IPHONEOS_DEPLOYMENT_TARGET: "16.0",
            PRODUCT_BUNDLE_IDENTIFIER: `"${ext.bundleId}"`,
            CODE_SIGN_ENTITLEMENTS: `"${ext.entitlements}"`,
            INFOPLIST_FILE: `"${ext.infoPlist}"`,
            SKIP_INSTALL: "YES",
            TARGETED_DEVICE_FAMILY: '"1,2"',
            ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: "NO",
          });

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

  // Step 5-6: Modify Podfile
  // withPodfile gives modResults as an object in some Expo versions, so we
  // use withDangerousMod to read/write the file directly from disk instead.
  config = withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      // Ensure iOS 16.0 platform (FamilyControls requires it)
      podfile = podfile.replace(
        /^platform :ios,\s*['"][^'"]+['"]/m,
        "platform :ios, '16.0'"
      );

      // Extension targets have zero CocoaPods dependencies — keep them out of
      // the Podfile. The Xcode project's Embed App Extensions build phase is
      // what makes Xcode bundle the .appex files into the .ipa.

      // Fix for Xcode 14+: resource bundle targets are signed by default which
      // breaks builds. Multiple plugins (reanimated, stripe, …) each append
      // their own `post_install` block; CocoaPods rejects Podfiles with more
      // than one. Since withScreenTime runs last in the plugins array we can
      // read the fully-assembled Podfile, merge every post_install block into
      // a single block, and append the CODE_SIGNING_ALLOWED fix.
      // Wrap Podfile changes in try-catch so that any regex/IO failure here
      // does NOT prevent the extension files below from being written.
      try {
        podfile = mergePostInstallHooks(podfile);
        fs.writeFileSync(podfilePath, podfile);
      } catch (e) {
        console.warn("[withScreenTime] Podfile post_install merge failed:", e?.message || e);
      }

      // ── Recreate extension support files ──────────────────────────────────
      // EAS Build clears the entire ios/ directory during prebuild. We must
      // recreate the entitlements AND Info.plist files for both extension
      // targets here, unconditionally, so Xcode can find them at build time.
      // These are always overwritten — never skipped — to ensure fresh content.
      const iosRoot = config.modRequest.platformProjectRoot;

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
 * Podfile into a single block, then appends CODE_SIGNING_ALLOWED = NO so
 * Xcode 14+ doesn't try to sign CocoaPods resource-bundle targets.
 *
 * Multiple plugins (stripe, reanimated, …) each append their own post_install
 * block. CocoaPods rejects Podfiles with more than one such block. Because
 * withScreenTime is the last plugin, by the time this runs the Podfile is
 * fully assembled and all other post_install blocks are already present.
 *
 * The regex matches `post_install do |installer|` through the first `^end`
 * at column 0, which is always the closing keyword for the outer block
 * (inner `end` statements are indented).
 */
function mergePostInstallHooks(podfile) {
  const re = /^post_install do \|installer\|\n([\s\S]*?)^end$/gm;

  const bodies = [];
  const stripped = podfile.replace(re, (_, body) => {
    bodies.push(body.trimEnd());
    return "";
  });

  if (bodies.length === 0) {
    // No existing post_install block — create one with just the signing fix
    const signingFix = [
      "  installer.pods_project.targets.each do |target|",
      "    target.build_configurations.each do |config|",
      "      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'",
      "    end",
      "  end",
    ].join("\n");
    return podfile.trimEnd() + "\n\npost_install do |installer|\n" + signingFix + "\nend\n";
  }

  // Append signing fix if no existing block already sets it
  const alreadyFixed = bodies.some((b) => b.includes("CODE_SIGNING_ALLOWED"));
  if (!alreadyFixed) {
    bodies.push(
      [
        "  installer.pods_project.targets.each do |target|",
        "    target.build_configurations.each do |config|",
        "      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'",
        "    end",
        "  end",
      ].join("\n")
    );
  }

  const mergedBlock =
    "post_install do |installer|\n" + bodies.join("\n") + "\nend";
  return stripped.trimEnd() + "\n\n" + mergedBlock + "\n";
}
