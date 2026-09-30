// Pitch correction: a direct C++ port of the web app's GemstarPitchProcessor
// (autocorrelation pitch detector + two-tap granular shifter that glides to
// the nearest note in the chosen scale, with an LFO for "humanize").
#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace gemstar {

struct PitchResult { float freq; float confidence; };

inline PitchResult detectPitch(const float* frame, int n, float sr, float minFreq, float maxFreq) {
  const int maxLag = std::min(n - 1, static_cast<int>(std::floor(sr / minFreq)));
  const int minLag = std::max(2, static_cast<int>(std::floor(sr / maxFreq)));
  double mean = 0;
  for (int i = 0; i < n; i++) mean += frame[i];
  mean /= n;
  std::vector<float> x(n);
  double energy = 0;
  for (int i = 0; i < n; i++) { x[i] = static_cast<float>(frame[i] - mean); energy += double(x[i]) * x[i]; }
  if (energy < 1e-9) return {0.0f, 0.0f};
  int bestLag = -1; double bestVal = -1e300;
  std::vector<double> acf(maxLag + 2, 0.0);
  for (int lag = minLag; lag <= maxLag; lag++) {
    float sum = 0;
    for (int i = 0; i < n - lag; i++) sum += x[i] * x[i + lag];
    acf[lag] = sum;
    if (sum > bestVal) { bestVal = sum; bestLag = lag; }
  }
  const double confidence = bestVal / energy;
  if (bestLag < 0 || confidence < 0.01) return {0.0f, 0.0f};
  double refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const double y0 = acf[bestLag - 1], y1 = acf[bestLag], y2 = acf[bestLag + 1];
    const double denom = y0 - 2 * y1 + y2;
    if (std::fabs(denom) > 1e-12) {
      const double shift = 0.5 * (y0 - y2) / denom;
      if (shift > -1 && shift < 1) refined = bestLag + shift;
    }
  }
  return {static_cast<float>(sr / refined),
          static_cast<float>(std::max(0.0, std::min(1.0, confidence)))};
}

inline float freqToMidi(float f) { return 69.0f + 12.0f * std::log2(f / 440.0f); }
inline float midiToFreq(float m) { return 440.0f * std::pow(2.0f, (m - 69.0f) / 12.0f); }
inline float nearestNoteFreq(float f) { return f <= 0 ? 0 : midiToFreq(std::round(freqToMidi(f))); }

// mask: 12 flags by pitch class (0 = C); all-false means chromatic.
inline float nearestScaleFreq(float f, const bool* mask, bool hasMask) {
  if (f <= 0) return 0;
  if (!hasMask) return nearestNoteFreq(f);
  const float m = freqToMidi(f);
  const int base = static_cast<int>(std::round(m));
  int best = base; float bestDist = 1e9f;
  for (int d = -6; d <= 6; d++) {
    const int cand = base + d;
    if (!mask[((cand % 12) + 12) % 12]) continue;
    const float dist = std::fabs(cand - m);
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  return bestDist > 1e8f ? nearestNoteFreq(f) : midiToFreq(static_cast<float>(best));
}

class GranularPitchShifter {
 public:
  explicit GranularPitchShifter(float sr = 48000, float grainMs = 80) {
    grain_ = std::max(64, static_cast<int>(std::lround(sr * grainMs / 1000.0f)));
    size_ = grain_ * 8;
    buf_.assign(size_, 0.0f);
    win_.resize(grain_ + 1);
    for (int i = 0; i <= grain_; i++)
      win_[i] = 0.5f - 0.5f * std::cos(2.0f * 3.14159265358979f * i / grain_);
    delay_[0] = static_cast<float>(grain_);
    delay_[1] = grain_ / 2.0f;
  }
  float process(float x, float ratio) {
    buf_[write_] = x;
    write_ = wrap(write_ + 1);
    float out = 0;
    for (int h = 0; h < 2; h++) {
      const float d = delay_[h];
      const float readPos = static_cast<float>(write_) - 1.0f - d;
      const float phase = d - grain_ * 0.5f;
      const int wi = std::max(0, std::min(grain_, static_cast<int>(std::floor(phase + 0.5f))));
      out += readInterp(readPos) * win_[wi];
      delay_[h] += (1.0f - ratio);
      while (delay_[h] > grain_ * 1.5f) delay_[h] -= grain_;
      while (delay_[h] < grain_ * 0.5f) delay_[h] += grain_;
    }
    return out;
  }
  void reset() { std::fill(buf_.begin(), buf_.end(), 0.0f); }

 private:
  int wrap(int i) const { return ((i % size_) + size_) % size_; }
  float readInterp(float pos) const {
    const int i0 = static_cast<int>(std::floor(pos));
    const float frac = pos - i0;
    const float a = buf_[wrap(i0)], b = buf_[wrap(i0 + 1)];
    return a + (b - a) * frac;
  }
  int grain_, size_, write_ = 0;
  std::vector<float> buf_, win_;
  float delay_[2];
};

class PitchCorrector {
 public:
  explicit PitchCorrector(float sr = 48000) : sr_(sr), shifter_(sr, 80) {
    analysis_.assign(kWin, 0.0f);
    ordered_.assign(kWin, 0.0f);
    for (bool& b : mask_) b = false;
  }
  void setScale(const bool* mask12) {
    hasMask_ = false;
    for (int i = 0; i < 12; i++) { mask_[i] = mask12[i]; hasMask_ = hasMask_ || mask12[i]; }
  }
  // speed, humanize: 0..100 knob values.
  float process(float x, float speed, float humanize) {
    analysis_[writePos_] = x;
    writePos_ = (writePos_ + 1) % kWin;
    sinceAnalysis_++;
    if (speed > 0 && sinceAnalysis_ >= kInterval) {
      sinceAnalysis_ = 0;
      for (int k = 0; k < kWin; k++) ordered_[k] = analysis_[(writePos_ + k) % kWin];
      const PitchResult pr = detectPitch(ordered_.data(), kWin, sr_, 70.0f, 1000.0f);
      voiced_ = pr.confidence > 0.35f && pr.freq > 0;
      targetRatio_ = voiced_ ? nearestScaleFreq(pr.freq, mask_, hasMask_) / pr.freq : 1.0f;
    }
    if (speed <= 0) {
      shifter_.process(x, 1.0f);  // keep the grain buffer warm for instant engage
      return x;
    }
    const float s = std::max(1.0f, std::min(100.0f, speed));
    const float tau = 0.18f * std::pow(0.003f / 0.18f, (s - 1.0f) / 99.0f);
    const float alpha = 1.0f - std::exp(-(1.0f / sr_) / tau);
    currentRatio_ += (targetRatio_ - currentRatio_) * alpha;
    float applied = currentRatio_;
    if (humanize > 0 && voiced_) {
      const float maxCents = 25.0f * (humanize / 100.0f);
      lfoPhase_ += 2.0f * 3.14159265358979f * 5.5f / sr_;
      if (lfoPhase_ > 2.0f * 3.14159265358979f) lfoPhase_ -= 2.0f * 3.14159265358979f;
      applied *= std::pow(2.0f, maxCents * std::sin(lfoPhase_) / 1200.0f);
    }
    return shifter_.process(x, applied);
  }

 private:
  static constexpr int kWin = 1024;
  static constexpr int kInterval = 512;
  float sr_;
  GranularPitchShifter shifter_;
  std::vector<float> analysis_, ordered_;
  int writePos_ = 0, sinceAnalysis_ = 0;
  float currentRatio_ = 1.0f, targetRatio_ = 1.0f, lfoPhase_ = 0;
  bool voiced_ = false, hasMask_ = false;
  bool mask_[12];
};

}  // namespace gemstar
