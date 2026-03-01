package com.anonymous.Alba

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.net.NetworkInterface
import java.util.Collections

/**
 * VPNDetectorModule — detects active VPN connections by scanning network interfaces.
 * Checks for interface names associated with VPN protocols:
 *   tun*   — OpenVPN, WireGuard
 *   ppp*   — PPTP, L2TP
 *   ipsec* — IPSec
 *
 * Registered via VPNDetectorPackage, added to MainApplication.kt.
 */
class VPNDetectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "VPNDetector"

    private val vpnPrefixes = listOf("tun", "ppp", "ipsec")

    @ReactMethod
    fun isVPNActive(promise: Promise) {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
                ?: return promise.resolve(buildResult(false))

            for (ni in Collections.list(interfaces)) {
                val name = ni.name.lowercase()
                if (vpnPrefixes.any { name.startsWith(it) } && ni.isUp) {
                    promise.resolve(buildResult(true))
                    return
                }
            }
            promise.resolve(buildResult(false))
        } catch (e: Exception) {
            // If we can't enumerate, assume no VPN rather than blocking the user
            promise.resolve(buildResult(false))
        }
    }

    private fun buildResult(isVPN: Boolean): WritableNativeMap {
        val map = WritableNativeMap()
        map.putBoolean("isVPN", isVPN)
        return map
    }
}
