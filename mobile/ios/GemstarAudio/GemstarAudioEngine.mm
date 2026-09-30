#import "GemstarAudioEngine.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>

#include <vector>

#include "engine_core.h"

static NSString *const kEngineErrorDomain = @"com.gemstaraudio.engine";

@implementation GemstarAudioEngine {
  gemstar::EngineCore _core;
  AudioUnit _unit;
  std::vector<float> _inBuf;
  BOOL _running;
  BOOL _observing;
  int _sampleRate;
}

+ (GemstarAudioEngine *)shared {
  static GemstarAudioEngine *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ instance = [[GemstarAudioEngine alloc] init]; });
  return instance;
}

- (instancetype)init {
  if ((self = [super init])) {
    _inBuf.assign(8192, 0.0f);
    _sampleRate = 48000;
  }
  return self;
}

- (BOOL)running { return _running; }
- (int)sampleRate { return _sampleRate; }

- (float)latencyMs {
  AVAudioSession *s = [AVAudioSession sharedInstance];
  return (float)((s.inputLatency + s.outputLatency + 2.0 * s.IOBufferDuration) * 1000.0);
}

#pragma mark - Permission

- (void)requestMicPermission:(void (^)(BOOL))completion {
  if (@available(iOS 17.0, *)) {
    [AVAudioApplication requestRecordPermissionWithCompletionHandler:completion];
  } else {
    [[AVAudioSession sharedInstance] requestRecordPermission:completion];
  }
}

#pragma mark - Render callback (real-time thread: no locks, no allocation)

static OSStatus RenderCallback(void *refCon, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *ts,
                               UInt32 bus, UInt32 frames, AudioBufferList *ioData) {
  GemstarAudioEngine *self = (__bridge GemstarAudioEngine *)refCon;
  return [self renderFrames:frames flags:flags timestamp:ts output:ioData];
}

- (OSStatus)renderFrames:(UInt32)frames
                   flags:(AudioUnitRenderActionFlags *)flags
               timestamp:(const AudioTimeStamp *)ts
                  output:(AudioBufferList *)ioData {
  const UInt32 n = std::min<UInt32>(frames, (UInt32)_inBuf.size());
  AudioBufferList inList;
  inList.mNumberBuffers = 1;
  inList.mBuffers[0].mNumberChannels = 1;
  inList.mBuffers[0].mDataByteSize = n * sizeof(float);
  inList.mBuffers[0].mData = _inBuf.data();
  if (AudioUnitRender(_unit, flags, ts, 1, n, &inList) != noErr) {
    std::fill(_inBuf.begin(), _inBuf.begin() + n, 0.0f);  // mic unavailable: silence
  }
  float *left = (float *)ioData->mBuffers[0].mData;
  float *right = ioData->mNumberBuffers > 1 ? (float *)ioData->mBuffers[1].mData : left;
  _core.renderPlanar(_inBuf.data(), left, right, (int)n);
  return noErr;
}

#pragma mark - Start / stop

- (BOOL)start:(NSError **)error {
  @synchronized(self) {
    if (_running) return YES;

    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSError *e = nil;
    // Measurement mode turns off the system's AGC/noise shaping: Gemstar does the processing.
    [session setCategory:AVAudioSessionCategoryPlayAndRecord
                    mode:AVAudioSessionModeMeasurement
                 options:AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetoothA2DP
                   error:&e];
    if (!e) [session setPreferredSampleRate:48000 error:nil];
    if (!e) [session setPreferredIOBufferDuration:0.005 error:nil];
    if (!e) [session setActive:YES error:&e];
    if (e) { if (error) *error = e; return NO; }

    _sampleRate = (int)session.sampleRate;
    _core.prepare((float)_sampleRate);

    AudioComponentDescription desc = {kAudioUnitType_Output, kAudioUnitSubType_RemoteIO,
                                      kAudioUnitManufacturer_Apple, 0, 0};
    AudioComponent comp = AudioComponentFindNext(NULL, &desc);
    OSStatus st = AudioComponentInstanceNew(comp, &_unit);
    if (st != noErr) return [self fail:error code:st what:@"create audio unit"];

    UInt32 one = 1;
    AudioUnitSetProperty(_unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &one, sizeof(one));

    AudioStreamBasicDescription stereo = {};
    stereo.mSampleRate = _sampleRate;
    stereo.mFormatID = kAudioFormatLinearPCM;
    stereo.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved;
    stereo.mBytesPerPacket = 4; stereo.mFramesPerPacket = 1; stereo.mBytesPerFrame = 4;
    stereo.mChannelsPerFrame = 2; stereo.mBitsPerChannel = 32;
    AudioStreamBasicDescription mono = stereo;
    mono.mChannelsPerFrame = 1;
    AudioUnitSetProperty(_unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &stereo, sizeof(stereo));
    AudioUnitSetProperty(_unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &mono, sizeof(mono));

    AURenderCallbackStruct cb = {RenderCallback, (__bridge void *)self};
    AudioUnitSetProperty(_unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, sizeof(cb));

    st = AudioUnitInitialize(_unit);
    if (st != noErr) return [self fail:error code:st what:@"initialize audio unit"];
    st = AudioOutputUnitStart(_unit);
    if (st != noErr) return [self fail:error code:st what:@"start audio unit"];

    if (!_observing) {
      NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
      [nc addObserver:self selector:@selector(onInterruption:) name:AVAudioSessionInterruptionNotification object:nil];
      [nc addObserver:self selector:@selector(onMediaReset:) name:AVAudioSessionMediaServicesWereResetNotification object:nil];
      _observing = YES;
    }
    _running = YES;
    return YES;
  }
}

- (BOOL)fail:(NSError **)error code:(OSStatus)st what:(NSString *)what {
  if (_unit) { AudioComponentInstanceDispose(_unit); _unit = NULL; }
  if (error) {
    *error = [NSError errorWithDomain:kEngineErrorDomain code:st
                             userInfo:@{NSLocalizedDescriptionKey : [NSString stringWithFormat:@"Could not %@ (%d)", what, (int)st]}];
  }
  return NO;
}

- (void)stop {
  @synchronized(self) {
    if (_unit) {
      AudioOutputUnitStop(_unit);
      AudioUnitUninitialize(_unit);
      AudioComponentInstanceDispose(_unit);
      _unit = NULL;
    }
    if (_running) [[AVAudioSession sharedInstance] setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
    _running = NO;
  }
}

#pragma mark - Interruptions (calls, Siri, alarms) and media reset

- (void)onInterruption:(NSNotification *)note {
  NSUInteger type = [note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
  if (type == AVAudioSessionInterruptionTypeBegan) {
    if (_unit) AudioOutputUnitStop(_unit);
  } else if (_running) {
    NSError *e = nil;
    [[AVAudioSession sharedInstance] setActive:YES error:&e];
    _core.reset();
    if (_unit && !e) AudioOutputUnitStart(_unit);
  }
}

- (void)onMediaReset:(NSNotification *)note {
  if (!_running) return;
  [self stop];
  [self start:nil];
}

#pragma mark - Controls

- (void)setKnobId:(NSString *)knobId value:(float)value {
  const int i = gemstar::Knobs::indexOf(knobId.UTF8String);
  if (i >= 0) _core.setKnob(i, std::max(0.0f, std::min(100.0f, value)));
}
- (void)setBypass:(BOOL)bypass { _core.setBypass(bypass); }
- (void)setOutputGainDb:(float)db { _core.setOutputGainDb(std::max(-24.0f, std::min(12.0f, db))); }
- (void)setScaleMask:(int)mask { _core.setScaleMask(mask & 0xFFF); }
- (float)takePeak { return _core.takePeak(); }

@end
