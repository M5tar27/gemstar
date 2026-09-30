// Platform-independent heart of the audio engine, shared by Android (Oboe) and
// iOS (RemoteIO). The platform layer only opens the audio devices and calls
// render*() from its real-time callback; everything else (thread-safe knob
// control, the vocal chain, output gain + limiter, level meter) lives here.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>

#include "dsp/vocal_chain.h"

namespace gemstar {

class EngineCore {
 public:
  // Call once the device sample rate is known (before the first render).
  void prepare(float sampleRate) {
    sampleRate_ = static_cast<int>(sampleRate);
    chain_.init(sampleRate);
    outStage_.init(sampleRate);
    appliedMask_ = -1;  // force scale to be re-sent
    prepared_ = true;
  }
  bool prepared() const { return prepared_; }
  int sampleRate() const { return sampleRate_; }

  // ---- control surface: any thread ----
  void setKnob(int index, float value) {
    if (index >= 0 && index < Knobs::kCount) knobs_[index].store(value, std::memory_order_relaxed);
  }
  void setBypass(bool b) { bypass_.store(b, std::memory_order_relaxed); }
  void setOutputGainDb(float db) { gainDb_.store(db, std::memory_order_relaxed); }
  void setScaleMask(int mask12) { scaleMask_.store(mask12, std::memory_order_relaxed); }
  // Highest output sample since the last call (0..1).
  float takePeak() { return peak_.exchange(0.0f, std::memory_order_relaxed); }

  // ---- audio thread ----
  // in: mono, may be null (treated as silence). out: interleaved stereo.
  void renderInterleaved(const float* in, float* out, int frames) {
    applyControls();
    float pk = 0;
    for (int i = 0; i < frames; i++) {
      float l, r;
      chain_.process(in ? in[i] : 0.0f, l, r);
      outStage_.process(l, r);
      out[2 * i] = l; out[2 * i + 1] = r;
      pk = std::max(pk, std::max(std::fabs(l), std::fabs(r)));
    }
    notePeak(pk);
  }

  // in: mono, may be null. outL/outR: separate channel buffers (iOS layout).
  void renderPlanar(const float* in, float* outL, float* outR, int frames) {
    applyControls();
    float pk = 0;
    for (int i = 0; i < frames; i++) {
      float l, r;
      chain_.process(in ? in[i] : 0.0f, l, r);
      outStage_.process(l, r);
      outL[i] = l; outR[i] = r;
      pk = std::max(pk, std::max(std::fabs(l), std::fabs(r)));
    }
    notePeak(pk);
  }

  // Clears reverb tails / delay lines (e.g. after an audio-route change).
  void reset() { chain_.reset(); }

 private:
  void applyControls() {
    Knobs k;
    float* kd = k.data();
    for (int i = 0; i < Knobs::kCount; i++) kd[i] = knobs_[i].load(std::memory_order_relaxed);
    chain_.setTargets(k);
    chain_.setBypass(bypass_.load(std::memory_order_relaxed));
    outStage_.setGainDb(gainDb_.load(std::memory_order_relaxed));
    const int mask = scaleMask_.load(std::memory_order_relaxed);
    if (mask != appliedMask_) {
      bool m[12];
      for (int i = 0; i < 12; i++) m[i] = (mask >> i) & 1;
      chain_.setScale(m);
      appliedMask_ = mask;
    }
  }
  void notePeak(float pk) {
    if (pk > peak_.load(std::memory_order_relaxed)) peak_.store(pk, std::memory_order_relaxed);
  }

  VocalChain chain_;
  OutputStage outStage_;
  std::atomic<float> knobs_[Knobs::kCount] = {};
  std::atomic<bool> bypass_{false};
  std::atomic<float> gainDb_{3.0f}, peak_{0.0f};
  std::atomic<int> scaleMask_{0};
  int appliedMask_ = -1, sampleRate_ = 48000;
  bool prepared_ = false;
};

}  // namespace gemstar
