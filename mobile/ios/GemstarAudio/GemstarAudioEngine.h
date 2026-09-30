#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Duplex (mic in -> Gemstar chain -> out) engine on a single RemoteIO unit.
@interface GemstarAudioEngine : NSObject

@property (class, readonly) GemstarAudioEngine *shared;
@property (readonly) BOOL running;
@property (readonly) int sampleRate;
@property (readonly) float latencyMs;

/// Asks for microphone permission if needed, then calls back on an arbitrary queue.
- (void)requestMicPermission:(void (^)(BOOL granted))completion;
- (BOOL)start:(NSError *_Nullable *_Nullable)error;
- (void)stop;

- (void)setKnobId:(NSString *)knobId value:(float)value;
- (void)setBypass:(BOOL)bypass;
- (void)setOutputGainDb:(float)db;
- (void)setScaleMask:(int)mask;
- (float)takePeak;

@end

NS_ASSUME_NONNULL_END
