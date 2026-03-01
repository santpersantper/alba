// VPNDetector.m
// Objective-C bridge — exposes VPNDetector Swift class to React Native.
// Add both files to the main Alba app target in Xcode (same as AlbaScreenTimeModule).

#import <React/RCTBridgeModule.h>

RCT_EXTERN_MODULE(VPNDetector, NSObject)

RCT_EXTERN_METHOD(isVPNActive:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
