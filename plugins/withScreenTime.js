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
      // breaks builds. Disable code signing for bundle targets only.
      // CocoaPods 1.x supports multiple post_install blocks so we just append.
      if (!podfile.includes("CODE_SIGNING_ALLOWED")) {
        podfile += `
post_install do |installer|
  installer.pods_project.targets.each do |target|
    if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"
      target.build_configurations.each do |config|
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      end
    end
  end
end
`;
      }

      fs.writeFileSync(podfilePath, podfile);

      // ── Recreate extension entitlements files ─────────────────────────────
      // EAS Build clears the entire ios/ directory during prebuild, wiping any
      // extension subdirectory files that were committed to git. We recreate
      // the entitlements files here so Xcode can find them at build time.
      const iosRoot = config.modRequest.platformProjectRoot;

      const extEntitlements = [
        {
          dir: "AlbaDeviceActivityExtension",
          filename: "AlbaDeviceActivityExtension.entitlements",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.alba.app.screentime</string>
    </array>
</dict>
</plist>`,
        },
        {
          dir: "AlbaDeviceActivityReport",
          filename: "AlbaDeviceActivityReport.entitlements",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.alba.app.screentime</string>
    </array>
</dict>
</plist>`,
        },
      ];

      for (const { dir, filename, content } of extEntitlements) {
        const dirPath = path.join(iosRoot, dir);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        const filePath = path.join(dirPath, filename);
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
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
      sourcesPhases[phaseUuid].files.push({
        value: buildFileUuid,
        comment: `${filename} in Sources`,
      });
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
 */
function embedExtensionsInMainTarget(proj, mainTargetUuid, extTargets) {
  const objects = proj.hash.project.objects;
  const nativeTargets = objects["PBXNativeTarget"] || {};
  const mainTarget = nativeTargets[mainTargetUuid];
  if (!mainTarget) return;

  // Ensure section maps exist
  objects["PBXCopyFilesBuildPhase"] = objects["PBXCopyFilesBuildPhase"] || {};
  objects["PBXBuildFile"] = objects["PBXBuildFile"] || {};
  objects["PBXTargetDependency"] = objects["PBXTargetDependency"] || {};
  objects["PBXContainerItemProxy"] = objects["PBXContainerItemProxy"] || {};

  // Create the Embed App Extensions copy phase
  const copyPhaseUuid = proj.generateUuid();
  const copyPhase = {
    isa: "PBXCopyFilesBuildPhase",
    buildActionMask: 2147483647,
    dstPath: '""',          // xcode lib writes values verbatim; '""' → dstPath = "";
    dstSubfolderSpec: 13,   // PlugIns — where app extensions live in the bundle
    files: [],
    name: '"Embed App Extensions"', // space-containing string must carry its own quotes
    runOnlyForDeploymentPostprocessing: 0,
  };
  objects["PBXCopyFilesBuildPhase"][copyPhaseUuid] = copyPhase;
  objects["PBXCopyFilesBuildPhase"][`${copyPhaseUuid}_comment`] =
    "Embed App Extensions";

  for (const extTarget of extTargets) {
    const extNative = extTarget.pbxNativeTarget;
    const extUuid = extTarget.uuid;
    const extName = extNative.name;
    const productRef = extNative.productReference;

    if (productRef) {
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
      copyPhase.files.push({
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

  // Add the copy phase to the main target's build phases
  mainTarget.buildPhases = mainTarget.buildPhases || [];
  mainTarget.buildPhases.push({
    value: copyPhaseUuid,
    comment: "Embed App Extensions",
  });
}
