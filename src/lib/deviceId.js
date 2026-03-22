import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";

const DEVICE_ID_KEY = "alba_device_id";

/**
 * Returns a stable composite device identifier.
 *
 * Format: "<secureStoreUUID>::<osName>::<osVersion>::<modelName>"
 *
 * The UUID component is generated once and persisted in SecureStore.
 * The hardware components (os, model) make the fingerprint harder to
 * spoof — a banned user would need both a fresh UUID AND matching
 * hardware info to bypass the device check.
 *
 * Returns null only if SecureStore is completely unavailable.
 */
export async function getDeviceId() {
  try {
    let baseId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!baseId) {
      baseId = Crypto.randomUUID();
      await SecureStore.setItemAsync(DEVICE_ID_KEY, baseId);
    }

    const os = (Device.osName ?? "").replace(/\s+/g, "_");
    const osVer = (Device.osVersion ?? "").replace(/\s+/g, "_");
    const model = (Device.modelName ?? "").replace(/\s+/g, "_");

    return `${baseId}::${os}::${osVer}::${model}`;
  } catch {
    return null;
  }
}
