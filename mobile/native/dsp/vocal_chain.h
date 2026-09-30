// The Gemstar vocal chain, ported stage-for-stage from buildVocalChain() and
// applyParamsTo() in the web app's index.html:
//
//   Clean -> Punch -> Bass -> Voice -> Smooth (de-ess) -> Highs -> Radio
//   -> Tune/Humanize (pitch) -> Space / Delay / Wide -> M5tar -> Jewels
//   plus the A/B bypass bus.
//
// Knob values are the same 0..100 numbers the web UI uses, and every knob ->
// parameter mapping below is copied from applyParamsTo(), including the M5tar
// macro that nudges Tune/Punch/Voice. Parameter changes glide with a 20 ms
// time constant, like setTargetAtTime(..., 0.02) in the browser.
//
// Keep the Clean stage in its own function (applyClean / processClean): the
// web version of that knob is still being reworked, so it is the one piece
// likely to be re-synced.
#pragma once

#include <cmath>
#include <cstring>
#include <memory>
#include <vector>

#include "pitch.h"
#include "primitives.h"

namespace gemstar {

struct Knobs {
  float clean = 0, punch = 0, bass = 0, voice = 0, highs = 0, smooth = 0, tune = 0,
        space = 0, wide = 0, radio = 0, m5tar = 0, jewels = 0, humanize = 0, delay = 0;
  static constexpr int kCount = 14;
  // Knob ids in struct order (same names the web app and the JS side use).
  static int indexOf(const char* id) {
    static const char* const kIds[kCount] = {"clean", "punch", "bass", "voice", "highs", "smooth", "tune",
                                             "space", "wide", "radio", "m5tar", "jewels", "humanize", "delay"};
    for (int i = 0; i < kCount; i++) {
      const char* a = kIds[i]; const char* b = id;
      while (*a && *a == *b) { a++; b++; }
      if (*a == 0 && *b == 0) return i;
    }
    return -1;
  }
  float* data() { return &clean; }
  const float* data() const { return &clean; }
};
static_assert(sizeof(Knobs) == Knobs::kCount * sizeof(float), "Knobs must be 14 packed floats");

class VocalChain {
 public:
  void init(float sampleRate) {
    sr_ = sampleRate;
    const float s = sr_;
    ctlAlpha_ = 1.0f - std::exp(-static_cast<float>(kCtl) / (0.02f * s));
    bypassAlpha_ = 1.0f - std::exp(-1.0f / (0.01f * s));

    punchComp_.init(s, 0.003f, 0.25f, 6.0f);
    radioComp_.init(s, 0.001f, 0.12f, 3.0f);
    deEssBand_.configure(BqType::BandPass, s, 6500, 1.4, 0);

    echo_.init(static_cast<int>(0.5f * s));
    for (int i = 0; i < 2; i++) {
      chorus_[i].init(static_cast<int>(0.03f * s));
      for (int c = 0; c < 2; c++) jChorus_[i][c].init(static_cast<int>(0.03f * s));
    }

    std::vector<float> l, r;
    makeReverbIR(s, 0.9f, 2.2f, 1, l, r);
    small_.init(l, r);
    makeReverbIR(s, 2.4f, 1.6f, 7, l, r);
    hall_.init(l, r);

    pitch_ = std::make_unique<PitchCorrector>(s);
    first_ = true;
  }

  // Target knob values (0..100). Call from the audio thread.
  void setTargets(const Knobs& k) { target_ = k; }
  void setBypass(bool b) { bypassTarget_ = b ? 1.0f : 0.0f; }
  void setScale(const bool* mask12) { pitch_->setScale(mask12); }

  // One mono sample in, one stereo sample out (before output gain/limiter).
  inline void process(float in, float& outL, float& outR) {
    if (ctlCount_ == 0) controlTick();
    if (++ctlCount_ >= kCtl) ctlCount_ = 0;
    bypassMix_ += bypassAlpha_ * (bypassTarget_ - bypassMix_);  // 1 = dry only

    // ---- mono front end ----
    float x = processClean(in);
    x = punchComp_.process(x) * p_.punchMakeup;
    x = bass_.process(x);
    x = voice_.process(x);
    x = x + p_.deEssGain * deEssBand_.process(x);          // Smooth
    x = highs_.process(x);
    const float radioWet = radioAir_.process(radioComp_.process(x) * p_.radioMakeup) * p_.radioWetGain;
    x = x * p_.radioDryGain + radioWet;                     // Radio (parallel)
    const float p = pitch_->process(x, p_.effTune, cur_.humanize);

    // ---- Space / Delay / Wide (mono in, stereo out) ----
    float l = p * p_.wideDry, r = p * p_.wideDry;
    if (spaceActive_) {
      float sl, sr2, hl, hr;
      small_.tick(p, sl, sr2);
      hall_.tick(p, hl, hr);
      l += sl * p_.smallWet + hl * p_.hallWet;
      r += sr2 * p_.smallWet + hr * p_.hallWet;
    }
    if (p_.echoWet > 0.0001f || echoActive_) {
      const float d = echo_.read(0.28f * sr_);
      echo_.write(p + 0.32f * d);
      l += d * p_.echoWet; r += d * p_.echoWet;
      echoActive_ = p_.echoWet > 0.0001f || std::fabs(d) > 1e-5f;
    } else {
      echo_.write(0.0f);
    }
    if (p_.chorusWet > 0.0001f) {
      chorus_[0].write(p); chorus_[1].write(p);
      const float a = chorus_[0].read((0.007f + 0.003f * std::sin(lfo_[0])) * sr_);
      const float b = chorus_[1].read((0.013f + 0.004f * std::sin(lfo_[1])) * sr_);
      l += (a * kPanA_L + b * kPanB_L) * p_.chorusWet;
      r += (a * kPanA_R + b * kPanB_R) * p_.chorusWet;
    }
    advanceLfos();

    // ---- M5tar: saturation + low-mid warmth, parallel ----
    const float m5 = cur_.m5tar / 100.0f;
    const float drive = 0.1f + m5 * 0.5f;
    float ml = l * p_.m5Dry + warm_[0].process(softClip(l, drive)) * p_.m5Wet;
    float mr = r * p_.m5Dry + warm_[1].process(softClip(r, drive)) * p_.m5Wet;

    // ---- Jewels: air shelf + two-tap stereo chorus, parallel ----
    float jl = ml * p_.jDry, jr = mr * p_.jDry;
    if (p_.jWet > 0.0001f) {
      const float al = air_[0].process(ml), ar = air_[1].process(mr);
      float cl[2][2];
      for (int t = 0; t < 2; t++) {
        jChorus_[t][0].write(al); jChorus_[t][1].write(ar);
        const float dsec = (t == 0 ? 0.009f : 0.015f) + p_.jDepth[t] * std::sin(jLfo_[t]);
        cl[t][0] = jChorus_[t][0].read(dsec * sr_);
        cl[t][1] = jChorus_[t][1].read(dsec * sr_);
      }
      // StereoPanner on a stereo input: tap A at pan -0.6, tap B at +0.6.
      const float gA = std::cos(0.2f * static_cast<float>(kPi));  // x = pan+1 = 0.4
      const float sA = std::sin(0.2f * static_cast<float>(kPi));
      const float gB = std::cos(0.3f * static_cast<float>(kPi));  // x = pan = 0.6
      const float sB = std::sin(0.3f * static_cast<float>(kPi));
      const float aL = cl[0][0] + cl[0][1] * gA, aR = cl[0][1] * sA;  // pan<=0
      const float bL = cl[1][0] * gB, bR = cl[1][1] + cl[1][0] * sB;  // pan>0
      jl += (aL + bL) * p_.jWet;
      jr += (aR + bR) * p_.jWet;
    } else {
      jChorus_[0][0].write(0); jChorus_[0][1].write(0);
      jChorus_[1][0].write(0); jChorus_[1][1].write(0);
    }
    advanceJewelsLfos();

    // ---- bypass bus: dry (raw input) vs fully processed ----
    outL = in * bypassMix_ + jl * (1.0f - bypassMix_);
    outR = in * bypassMix_ + jr * (1.0f - bypassMix_);
  }

  void reset() {
    small_.reset(); hall_.reset(); echo_.reset();
    for (auto& d : chorus_) d.reset();
    for (auto& a : jChorus_) for (auto& d : a) d.reset();
  }

 private:
  static constexpr int kCtl = 64;  // control-rate update interval (samples)
  // Equal-power pan gains for a mono source (Web Audio StereoPanner).
  static constexpr float kPanA_L = 0.9876883f, kPanA_R = 0.1564345f;  // pan -0.8
  static constexpr float kPanB_L = 0.1564345f, kPanB_R = 0.9876883f;  // pan +0.8

  // Derived per-stage values (recomputed from the smoothed knobs).
  struct Derived {
    float punchMakeup = 1, deEssGain = 0, radioMakeup = 1, radioDryGain = 1, radioWetGain = 0,
          effTune = 0, wideDry = 1, smallWet = 0, hallWet = 0, echoWet = 0, chorusWet = 0,
          m5Dry = 1, m5Wet = 0, jDry = 1, jWet = 0, jDepth[2] = {0, 0};
  };

  // ---- Clean: rumble high-pass + noise-gate curve + hiss shelf ----
  void applyClean(float clean) {
    rumble_.configure(BqType::HighPass, sr_, lerpf(clean, 0, 100, 30, 120), 0.707, 0);
    hiss_.configure(BqType::HighShelf, sr_, 8500, 0, lerpf(clean, 0, 100, 0, -6));
  }
  inline float processClean(float x) {
    x = rumble_.process(x);
    x = gateShape(x, cur_.clean / 100.0f);
    return hiss_.process(x);
  }

  void controlTick() {
    const float* t = target_.data();
    float* c = cur_.data();
    float maxDiff = 0;
    for (int i = 0; i < Knobs::kCount; i++) {
      const float d = t[i] - c[i];
      maxDiff = std::max(maxDiff, std::fabs(d));
      c[i] += std::fabs(d) < 0.01f ? d : d * ctlAlpha_;
    }
    if (!first_ && maxDiff < 0.0005f) return;  // already settled, skip the math
    first_ = false;
    applyParams(cur_);
  }

  void applyParams(const Knobs& v) {
    const float m5 = v.m5tar / 100.0f;
    const float effTune = std::min(100.0f, v.tune + m5 * 20);
    const float effPunch = std::min(100.0f, v.punch + m5 * 40);
    const float effVoice = std::min(100.0f, v.voice + m5 * 60);
    const float effJewels = v.jewels;

    applyClean(v.clean);

    punchComp_.setParams(lerpf(effPunch, 0, 100, 0, -30), lerpf(effPunch, 0, 100, 1, 10));
    p_.punchMakeup = dbToGain(lerpf(effPunch, 0, 100, 0, 4));

    bass_.configure(BqType::LowShelf, sr_, 150, 0, lerpf(v.bass, 0, 100, -6, 9));
    voice_.configure(BqType::Peaking, sr_, 2200, 1.1, lerpf(effVoice, 0, 100, -6, 8));
    highs_.configure(BqType::HighShelf, sr_, 9500, 0, lerpf(v.highs, 0, 100, -6, 9));

    p_.deEssGain = -(v.smooth / 100.0f) * 1.1f;

    const float rd = v.radio / 100.0f;
    radioComp_.setParams(lerpf(v.radio, 0, 100, -6, -32), lerpf(v.radio, 0, 100, 1.5f, 10));
    p_.radioMakeup = dbToGain(lerpf(v.radio, 0, 100, 0, 6));
    radioAir_.configure(BqType::HighShelf, sr_, 11000, 0, lerpf(v.radio, 0, 100, 0, 6));
    p_.radioDryGain = 1.0f - rd * 0.6f;
    p_.radioWetGain = rd;

    p_.effTune = effTune;

    const float sp = v.space;
    p_.smallWet = sp <= 30 ? lerpf(sp, 0, 30, 0, 0.35f) : lerpf(sp, 30, 100, 0.35f, 0.06f);
    p_.hallWet = lerpf(sp, 20, 100, 0, 0.45f);
    const bool wasActive = spaceActive_;
    spaceActive_ = sp > 0.02f;
    if (wasActive && !spaceActive_) { small_.reset(); hall_.reset(); }

    const float wd = v.wide;
    p_.chorusWet = lerpf(wd, 0, 100, 0, 0.6f);
    p_.echoWet = lerpf(v.delay, 0, 100, 0, 0.4f);
    const float spaceWideDry = 1.0f - (sp / 100.0f) * 0.3f - (wd / 100.0f) * 0.25f - (v.delay / 100.0f) * 0.2f;
    p_.wideDry = std::max(0.35f, spaceWideDry);

    warm_[0].configure(BqType::Peaking, sr_, 500, 0.9, lerpf(v.m5tar, 0, 100, 0, 5));
    warm_[1].configure(BqType::Peaking, sr_, 500, 0.9, lerpf(v.m5tar, 0, 100, 0, 5));
    p_.m5Dry = 1.0f - m5 * 0.5f;
    p_.m5Wet = m5;

    const float jw = effJewels / 100.0f;
    air_[0].configure(BqType::HighShelf, sr_, 9500, 0, lerpf(effJewels, 0, 100, 0, 8));
    air_[1].configure(BqType::HighShelf, sr_, 9500, 0, lerpf(effJewels, 0, 100, 0, 8));
    p_.jDepth[0] = lerpf(effJewels, 0, 100, 0, 0.003f);
    p_.jDepth[1] = lerpf(effJewels, 0, 100, 0, 0.004f);
    p_.jDry = 1.0f - jw * 0.4f;
    p_.jWet = jw;
  }

  void advanceLfos() {
    lfo_[0] += 2.0f * static_cast<float>(kPi) * 0.6f / sr_;
    lfo_[1] += 2.0f * static_cast<float>(kPi) * 0.9f / sr_;
    for (float& f : lfo_) if (f > 6.2831853f) f -= 6.2831853f;
  }
  void advanceJewelsLfos() {
    jLfo_[0] += 2.0f * static_cast<float>(kPi) * 0.8f / sr_;
    jLfo_[1] += 2.0f * static_cast<float>(kPi) * 1.3f / sr_;
    for (float& f : jLfo_) if (f > 6.2831853f) f -= 6.2831853f;
  }

  float sr_ = 48000, ctlAlpha_ = 0.05f, bypassAlpha_ = 0.002f;
  Knobs target_, cur_;
  float bypassTarget_ = 0, bypassMix_ = 0;
  int ctlCount_ = 0;
  bool first_ = true, spaceActive_ = false, echoActive_ = false;
  Derived p_;

  Biquad rumble_, hiss_, bass_, voice_, highs_, deEssBand_, radioAir_, warm_[2], air_[2];
  Compressor punchComp_, radioComp_;
  DelayLine echo_, chorus_[2], jChorus_[2][2];
  StereoConvolver small_, hall_;
  std::unique_ptr<PitchCorrector> pitch_;
  float lfo_[2] = {0, 0}, jLfo_[2] = {0, 0};
};

// Final stage shared by every output path: Output Gain fader (dB) feeding a
// true-peak safety limiter (threshold -0.3 dB, ratio 20, 2 ms / 200 ms),
// linked across both channels. Like the browser's compressor it looks ahead
// (6 ms) so the gain is already down when a peak arrives, and a last hard
// ceiling at +/-0.999 catches whatever the smoothing lets through.
class OutputStage {
 public:
  void init(float sr) {
    limiter_.init(sr, 0.002f, 0.2f, 0.0f);
    limiter_.setParams(-0.3f, 20.0f);
    gainAlpha_ = 1.0f - std::exp(-1.0f / (0.03f * sr));
    look_ = std::max(1, static_cast<int>(0.006f * sr));
    dl_.assign(look_, 0.0f); dr_.assign(look_, 0.0f);
    pos_ = 0;
  }
  void setGainDb(float db) { targetGain_ = dbToGain(db); }
  inline void process(float& l, float& r) {
    gain_ += gainAlpha_ * (targetGain_ - gain_);
    l *= gain_; r *= gain_;
    const float g = limiter_.gain(std::max(std::fabs(l), std::fabs(r)));
    const float ol = dl_[pos_], orr = dr_[pos_];
    dl_[pos_] = l; dr_[pos_] = r;
    if (++pos_ >= look_) pos_ = 0;
    l = std::max(-0.999f, std::min(0.999f, ol * g));
    r = std::max(-0.999f, std::min(0.999f, orr * g));
  }

 private:
  Compressor limiter_;
  std::vector<float> dl_, dr_;
  int look_ = 288, pos_ = 0;
  float gain_ = 1.4125375f, targetGain_ = 1.4125375f, gainAlpha_ = 0.001f;  // default +3 dB
};

}  // namespace gemstar
