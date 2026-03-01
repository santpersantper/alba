// vpnDetector.js
// Checks whether a VPN is active by calling the VPNDetector native module
// (iOS: VPNDetector.swift via ifaddrs; Android: VPNDetectorModule.kt via NetworkInterface).
// Falls back to false if the native module is unavailable (e.g. simulator without the module).

import { NativeModules } from "react-native";

const NativeVPNDetector = NativeModules.VPNDetector ?? null;

/**
 * Returns true if a VPN interface is currently active on the device.
 * Always resolves — never throws.
 */
export async function checkVPN() {
  if (!NativeVPNDetector) return false;
  try {
    const result = await NativeVPNDetector.isVPNActive();
    return result?.isVPN === true;
  } catch {
    return false;
  }
}
