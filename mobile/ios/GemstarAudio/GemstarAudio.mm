// React Native bridge: NativeModules.GemstarAudio on iOS. Same surface as the
// Android module (GemstarAudioModule.kt) so the JS code is identical.
#import <React/RCTBridgeModule.h>

#import "GemstarAudioEngine.h"

@interface GemstarAudio : NSObject <RCTBridgeModule>
@end

@implementation GemstarAudio

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup { return NO; }

// Asks for mic permission (first launch shows the system prompt), then starts.
RCT_EXPORT_METHOD(start : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [[GemstarAudioEngine shared] requestMicPermission:^(BOOL granted) {
    if (!granted) { resolve(@NO); return; }
    NSError *error = nil;
    if ([[GemstarAudioEngine shared] start:&error]) resolve(@YES);
    else reject(@"ENGINE_START", error.localizedDescription, error);
  }];
}

RCT_EXPORT_METHOD(stop : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [[GemstarAudioEngine shared] stop];
  resolve(nil);
}

RCT_EXPORT_METHOD(setKnob : (NSString *)knobId value : (double)value) {
  [[GemstarAudioEngine shared] setKnobId:knobId value:(float)value];
}

RCT_EXPORT_METHOD(setKnobs : (NSDictionary *)values) {
  for (NSString *key in values) {
    [[GemstarAudioEngine shared] setKnobId:key value:[values[key] floatValue]];
  }
}

RCT_EXPORT_METHOD(setBypass : (BOOL)bypass) { [[GemstarAudioEngine shared] setBypass:bypass]; }
RCT_EXPORT_METHOD(setOutputGainDb : (double)db) { [[GemstarAudioEngine shared] setOutputGainDb:(float)db]; }
RCT_EXPORT_METHOD(setScaleMask : (double)mask) { [[GemstarAudioEngine shared] setScaleMask:(int)mask]; }

RCT_EXPORT_METHOD(getStatus : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  GemstarAudioEngine *e = [GemstarAudioEngine shared];
  resolve(@{@"running" : @(e.running), @"sampleRate" : @(e.sampleRate), @"latencyMs" : @(e.latencyMs)});
}

RCT_EXPORT_METHOD(takePeak : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  resolve(@([[GemstarAudioEngine shared] takePeak]));
}

- (void)invalidate { [[GemstarAudioEngine shared] stop]; }

@end
