// VPNDetector.swift
// Detects whether a VPN is currently active by enumerating network interfaces.
// Checks for interface names associated with common VPN protocols:
//   utun*  — WireGuard, OpenVPN (iOS TUN layer), IKEv2
//   ppp*   — PPTP, L2TP
//   ipsec* — IPSec
//   tun*   — generic TUN (rare on iOS but included for completeness)
//
// No entitlements required — uses the standard POSIX ifaddrs API.

import Foundation

@objc(VPNDetector)
class VPNDetector: NSObject {

  private static let vpnPrefixes = ["utun", "ppp", "ipsec", "tun"]

  /// Resolves with { isVPN: Bool }.
  @objc func isVPNActive(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    var ifaddr: UnsafeMutablePointer<ifaddrs>?

    guard getifaddrs(&ifaddr) == 0 else {
      // If we can't enumerate interfaces, assume no VPN rather than blocking the user
      resolve(["isVPN": false])
      return
    }
    defer { freeifaddrs(ifaddr) }

    var ptr = ifaddr
    while let current = ptr {
      let name = String(cString: current.pointee.ifa_name)
      let hasAddress = current.pointee.ifa_addr != nil

      if hasAddress && Self.vpnPrefixes.contains(where: { name.hasPrefix($0) }) {
        resolve(["isVPN": true])
        return
      }
      ptr = current.pointee.ifa_next
    }

    resolve(["isVPN": false])
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
