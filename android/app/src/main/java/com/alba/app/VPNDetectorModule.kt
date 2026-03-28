package com.alba.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import com.facebook.react.bridge.*

class VPNDetectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "VPNDetector"

    @ReactMethod
    fun isVPNActive(promise: Promise) {
        try {
            val cm = reactApplicationContext
                .getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

            val isVpn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork
                val caps = cm.getNetworkCapabilities(network)
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
            } else {
                @Suppress("DEPRECATION")
                cm.activeNetworkInfo?.typeName?.equals("VPN", ignoreCase = true) == true
            }

            val result = WritableNativeMap()
            result.putBoolean("isVPN", isVpn)
            promise.resolve(result)
        } catch (e: Exception) {
            // Never throw — return false on any error (matches JS fallback)
            val result = WritableNativeMap()
            result.putBoolean("isVPN", false)
            promise.resolve(result)
        }
    }
}
