// Host-side checks for the native DSP (no Android needed):
//   g++ -O2 -std=c++17 -I.. chain_test.cpp -o chain_test && ./chain_test
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <random>

#include "engine_core.h"

using namespace gemstar;

static int failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { failures++; std::printf("FAIL: " __VA_ARGS__); std::printf("\n"); } else { std::printf("ok:   " __VA_ARGS__); std::printf("\n"); } } while (0)

// Magnitude response of a biquad at a frequency, by running a sine through it.
static double biquadGainDb(BqType t, double f0, double q, double gDb, double probe, double sr) {
  Biquad b; b.configure(t, sr, f0, q, gDb);
  const int n = static_cast<int>(sr);  // 1 s
  double peak = 0;
  for (int i = 0; i < n; i++) {
    float y = b.process(static_cast<float>(std::sin(2 * kPi * probe * i / sr)));
    if (i > n / 2) peak = std::max(peak, static_cast<double>(std::fabs(y)));
  }
  return 20 * std::log10(peak);
}

static void testBiquads() {
  const double sr = 48000;
  CHECK(std::fabs(biquadGainDb(BqType::LowShelf, 150, 0, 9, 20, sr) - 9) < 0.3, "lowshelf +9 dB at 20 Hz");
  CHECK(std::fabs(biquadGainDb(BqType::HighShelf, 9500, 0, -6, 20000, sr) + 6) < 0.3, "highshelf -6 dB at 20 kHz");
  CHECK(std::fabs(biquadGainDb(BqType::Peaking, 2200, 1.1, 8, 2200, sr) - 8) < 0.2, "peaking +8 dB at centre");
  CHECK(std::fabs(biquadGainDb(BqType::BandPass, 6500, 1.4, 0, 6500, sr)) < 0.2, "bandpass 0 dB at centre");
  CHECK(biquadGainDb(BqType::HighPass, 120, 0.707, 0, 30, sr) < -20, "highpass 120 Hz kills 30 Hz");
  CHECK(std::fabs(biquadGainDb(BqType::HighPass, 120, 0.707, 0, 2000, sr)) < 0.3, "highpass passes 2 kHz");
}

static void testConvolver() {
  std::mt19937 rng(1);
  std::uniform_real_distribution<float> u(-1, 1);
  std::vector<float> irL(3000), irR(3000);
  for (auto& v : irL) v = u(rng) * 0.1f;
  for (auto& v : irR) v = u(rng) * 0.1f;
  StereoConvolver c; c.init(irL, irR);
  const int n = 8192;
  std::vector<float> x(n), yl(n), yr(n);
  for (auto& v : x) v = u(rng);
  for (int i = 0; i < n; i++) c.tick(x[i], yl[i], yr[i]);
  double maxErr = 0;
  const int delay = StereoConvolver::kBlock;
  for (int i = 0; i < n - delay; i++) {
    double accL = 0, accR = 0;
    for (int k = 0; k < 3000 && k <= i; k++) { accL += x[i - k] * irL[k]; accR += x[i - k] * irR[k]; }
    maxErr = std::max(maxErr, std::fabs(accL - yl[i + delay]));
    maxErr = std::max(maxErr, std::fabs(accR - yr[i + delay]));
  }
  CHECK(maxErr < 1e-3, "FFT convolver matches direct convolution (max err %.2e, 1 block latency)", maxErr);
}

static void testCompressor() {
  Compressor c; c.init(48000, 0.003f, 0.25f, 6.0f);
  c.setParams(-30.0f, 10.0f);
  for (int i = 0; i < 48000; i++) c.process(0.5f * std::sin(2 * 3.14159f * 220 * i / 48000));
  // steady-state: loud sine must come out well below its input peak
  float peak = 0;
  for (int i = 0; i < 4800; i++) peak = std::max(peak, std::fabs(c.process(0.5f * std::sin(2 * 3.14159f * 220 * i / 48000))));
  CHECK(peak < 0.5f && peak > 0.05f, "compressor reduces a 0.5 peak sine to %.3f", peak);
  Compressor pass; pass.init(48000, 0.003f, 0.25f, 6.0f); pass.setParams(0.0f, 1.0f);
  float y = 0; for (int i = 0; i < 1000; i++) y = pass.process(0.3f);
  CHECK(std::fabs(y - 0.3f) < 1e-3f, "punch=0 (0 dB, 1:1) is a pass-through (%.4f)", y);
}

struct Preset { const char* name; Knobs k; };
static Knobs mk(float clean, float punch, float bass, float voice, float highs, float smooth, float tune,
                float space, float wide, float radio, float m5, float jewels, float humanize, float delay) {
  Knobs k; k.clean = clean; k.punch = punch; k.bass = bass; k.voice = voice; k.highs = highs; k.smooth = smooth;
  k.tune = tune; k.space = space; k.wide = wide; k.radio = radio; k.m5tar = m5; k.jewels = jewels;
  k.humanize = humanize; k.delay = delay; return k;
}

static void testChain() {
  const float sr = 48000;
  const Preset presets[] = {
      {"default(all 0)", mk(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)},
      {"M5TAR_VOCAL", mk(45, 65, 55, 66, 20, 40, 10, 25, 15, 25, 70, 0, 15, 0)},
      {"JEWELS_VOCAL", mk(35, 45, 26, 66, 35, 38, 15, 50, 45, 20, 0, 70, 20, 0)},
      {"AUTO_TUNED", mk(40, 55, 45, 60, 20, 45, 85, 45, 15, 35, 15, 15, 5, 0)},
      {"everything max", mk(100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100)},
  };
  for (const Preset& pr : presets) {
    VocalChain chain; chain.init(sr);
    OutputStage out; out.init(sr);
    chain.setTargets(pr.k);
    const int n = static_cast<int>(sr * 4);
    bool finite = true; float peak = 0; double energy = 0; int energyN = 0;
    for (int i = 0; i < n; i++) {
      // voiced test signal: 200 Hz + harmonics with slow vibrato, plus a little noise
      const double t = i / sr;
      const double f = 200.0 * (1.0 + 0.004 * std::sin(2 * kPi * 5 * t));
      float x = 0.25f * std::sin(2 * kPi * f * t) + 0.12f * std::sin(4 * kPi * f * t) + 0.06f * std::sin(6 * kPi * f * t);
      x += 0.002f * (static_cast<float>(rand()) / RAND_MAX - 0.5f);
      float l, r; chain.process(x, l, r); out.process(l, r);
      if (!std::isfinite(l) || !std::isfinite(r)) finite = false;
      peak = std::max(peak, std::max(std::fabs(l), std::fabs(r)));
      if (i > n / 2) { energy += l * l + r * r; energyN += 2; }
    }
    CHECK(finite && peak <= 1.05f && peak > 0.01f, "%-16s finite, peak %.3f, rms %.3f", pr.name, peak, std::sqrt(energy / energyN));
  }
}

static void testBypassAndTiming() {
  const float sr = 48000;
  VocalChain chain; chain.init(sr);
  chain.setTargets(mk(45, 65, 55, 66, 20, 40, 10, 25, 15, 25, 70, 0, 15, 0));
  chain.setBypass(true);
  float l = 0, r = 0, err = 0;
  for (int i = 0; i < 48000; i++) {
    float x = 0.3f * std::sin(2 * kPi * 330 * i / sr);
    chain.process(x, l, r);
    if (i > 24000) err = std::max(err, std::fabs(l - x));
  }
  CHECK(err < 0.01f, "bypass returns the raw input (err %.4f)", err);

  // CPU: seconds of audio processed per second of wall time, heavy preset
  VocalChain heavy; heavy.init(sr);
  heavy.setTargets(mk(60, 70, 55, 65, 30, 50, 85, 60, 55, 45, 40, 40, 25, 30));
  const int n = static_cast<int>(sr * 10);
  auto t0 = std::chrono::steady_clock::now();
  float acc = 0;
  for (int i = 0; i < n; i++) {
    float x = 0.25f * std::sin(2 * kPi * 220 * i / sr);
    heavy.process(x, l, r); acc += l;
  }
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::printf("info: heavy preset ran 10 s of audio in %.2f s (%.0fx realtime, acc %.1f)\n", secs, 10.0 / secs, acc);
  CHECK(10.0 / secs > 8.0, "chain runs faster than 8x realtime on host");
}

static void testKnobIds() {
  const char* order[] = {"clean", "punch", "bass", "voice", "highs", "smooth", "tune",
                         "space", "wide", "radio", "m5tar", "jewels", "humanize", "delay"};
  bool ok = true;
  for (int i = 0; i < 14; i++) ok = ok && Knobs::indexOf(order[i]) == i;
  CHECK(ok && Knobs::indexOf("nope") == -1 && Knobs::indexOf("clea") == -1, "knob id -> index mapping matches struct order");
}

static void testEngineCore() {
  const float sr = 48000;
  EngineCore a, b;
  a.prepare(sr); b.prepare(sr);
  for (EngineCore* e : {&a, &b}) { e->setKnob(0, 45); e->setKnob(1, 65); e->setKnob(7, 25); e->setOutputGainDb(0); }
  const int n = 4800;
  std::vector<float> in(n), inter(2 * n), l(n), r(n);
  for (int i = 0; i < n; i++) in[i] = 0.3f * std::sin(2 * kPi * 220 * i / sr);
  a.renderInterleaved(in.data(), inter.data(), n);
  b.renderPlanar(in.data(), l.data(), r.data(), n);
  float maxDiff = 0;
  for (int i = 0; i < n; i++) maxDiff = std::max(maxDiff, std::max(std::fabs(inter[2 * i] - l[i]), std::fabs(inter[2 * i + 1] - r[i])));
  CHECK(maxDiff < 1e-6f, "interleaved (Android) and planar (iOS) render paths match (diff %.1e)", maxDiff);
  const float pk = a.takePeak();
  CHECK(pk > 0.05f && pk <= 1.0f && a.takePeak() == 0.0f, "peak meter reports %.3f then resets", pk);
  std::vector<float> silent(2 * n);
  EngineCore c; c.prepare(sr);
  c.renderInterleaved(nullptr, silent.data(), n);
  float mx = 0; for (float v : silent) mx = std::max(mx, std::fabs(v));
  CHECK(mx < 1e-3f, "null input renders silence (%.1e)", mx);
}

int main() {
  testBiquads();
  testConvolver();
  testCompressor();
  testChain();
  testBypassAndTiming();
  testKnobIds();
  testEngineCore();
  std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
  return failures ? 1 : 0;
}
