# Gemstar for Android

React Native app shell (login, knob console, presets) + a native C++/Oboe audio
engine that is a stage-for-stage port of the web app's vocal chain.

```
mobile/
  App.tsx, src/                      screens, API client, knob/preset definitions
  android/app/                       RN host app (com.gemstaraudio.app)
  android/gemstar-audio/             native audio engine (Android library module)
    src/main/cpp/engine.cpp          Oboe full-duplex mic -> chain -> out, JNI
  native/                            shared by Android and iOS (no platform code)
    dsp/                             primitives.h, pitch.h, vocal_chain.h
    engine_core.h                    thread-safe knobs + render + limiter + meter
    test/chain_test.cpp              host tests (no phone needed)
```

## Checks you can run anywhere

```sh
# native DSP tests
g++ -O2 -std=c++17 -Inative native/test/chain_test.cpp -o /tmp/chain_test && /tmp/chain_test
# JS
npm ci && npx tsc --noEmit && npx jest
```

## Build the APK

GitHub Actions (`.github/workflows/mobile-build.yml`) builds a debug APK on every push
to `mobile`; download it from the run's artifacts. Locally: install Android Studio
(SDK 37, NDK 27.1.12297006), then `npm ci && cd android && ./gradlew assembleDebug`.

## Keeping the web and Android chains in sync

The knob -> parameter mapping lives in `applyParams()` in `vocal_chain.h` and mirrors
`applyParamsTo()` in the web `index.html`. When a web knob changes, update the matching
line there (Clean has its own `applyClean` / `processClean`).

## iOS

`ios/` is the Xcode project; the audio engine is the local pod `ios/GemstarAudio`
(RemoteIO duplex + the same shared C++ in `native/`). CI proves it compiles for the
simulator. Installing on a real iPhone needs an Apple Developer account (signing +
TestFlight) — not set up yet.
