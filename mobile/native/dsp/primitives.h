// Gemstar DSP primitives: the building blocks the web app gets for free from
// the Web Audio API (BiquadFilterNode, DynamicsCompressorNode, WaveShaperNode,
// DelayNode, ConvolverNode), re-implemented so the native Android engine can
// reproduce the same vocal chain. Header-only, no Android/Oboe dependency, so
// it also compiles on a desktop for the host tests in ../test.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace gemstar {

constexpr double kPi = 3.14159265358979323846;

inline float lerpf(float v, float x0, float x1, float y0, float y1) {
  if (v <= x0) return y0;
  if (v >= x1) return y1;
  float t = (v - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}
inline float dbToGain(float db) { return std::pow(10.0f, db / 20.0f); }

// ---------------------------------------------------------------- Biquad --
// Coefficient formulas follow the Web Audio spec (RBJ cookbook variants) so a
// knob setting lands on the same curve as the browser. Note the spec quirk
// kept on purpose: for highpass, Q is expressed in dB.
enum class BqType { HighPass, LowShelf, HighShelf, Peaking, BandPass };

class Biquad {
 public:
  void configure(BqType type, double sr, double freq, double q, double gainDb) {
    const double w0 = 2.0 * kPi * std::min(freq, sr * 0.49) / sr;
    const double cw = std::cos(w0), sw = std::sin(w0);
    double b0, b1, b2, a0, a1, a2;
    switch (type) {
      case BqType::HighPass: {
        double g = std::pow(10.0, q / 20.0);
        double alpha = sw / (2.0 * g);
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      }
      case BqType::LowShelf: {
        double A = std::pow(10.0, gainDb / 40.0);
        double alpha = sw / std::sqrt(2.0);  // shelf slope S = 1
        double sA = std::sqrt(A);
        b0 = A * ((A + 1) - (A - 1) * cw + 2 * sA * alpha);
        b1 = 2 * A * ((A - 1) - (A + 1) * cw);
        b2 = A * ((A + 1) - (A - 1) * cw - 2 * sA * alpha);
        a0 = (A + 1) + (A - 1) * cw + 2 * sA * alpha;
        a1 = -2 * ((A - 1) + (A + 1) * cw);
        a2 = (A + 1) + (A - 1) * cw - 2 * sA * alpha;
        break;
      }
      case BqType::HighShelf: {
        double A = std::pow(10.0, gainDb / 40.0);
        double alpha = sw / std::sqrt(2.0);
        double sA = std::sqrt(A);
        b0 = A * ((A + 1) + (A - 1) * cw + 2 * sA * alpha);
        b1 = -2 * A * ((A - 1) + (A + 1) * cw);
        b2 = A * ((A + 1) + (A - 1) * cw - 2 * sA * alpha);
        a0 = (A + 1) - (A - 1) * cw + 2 * sA * alpha;
        a1 = 2 * ((A - 1) - (A + 1) * cw);
        a2 = (A + 1) - (A - 1) * cw - 2 * sA * alpha;
        break;
      }
      case BqType::Peaking: {
        double A = std::pow(10.0, gainDb / 40.0);
        double alpha = sw / (2.0 * q);
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      }
      case BqType::BandPass:
      default: {
        double alpha = sw / (2.0 * q);  // constant 0 dB peak gain
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      }
    }
    b0_ = b0 / a0; b1_ = b1 / a0; b2_ = b2 / a0;
    a1_ = a1 / a0; a2_ = a2 / a0;
  }

  inline float process(float x) {
    double y = b0_ * x + z1_;
    z1_ = b1_ * x - a1_ * y + z2_;
    z2_ = b2_ * x - a2_ * y;
    return static_cast<float>(y);
  }
  void reset() { z1_ = z2_ = 0; }

 private:
  double b0_ = 1, b1_ = 0, b2_ = 0, a1_ = 0, a2_ = 0;
  double z1_ = 0, z2_ = 0;
};

// ------------------------------------------------------------ Compressor --
// Feed-forward peak compressor with a quadratic soft knee, attack/release
// smoothing of the gain reduction, and the same automatic makeup-gain rule
// the browser's DynamicsCompressorNode uses: makeup = (1 / outputAt0dBFS)^0.6.
// The browser also adds ~6 ms of look-ahead; this version has none, so it
// reacts a hair later on the very first transient. Approximation, not bit-exact.
class Compressor {
 public:
  void init(float sr, float attackSec, float releaseSec, float kneeDb) {
    sr_ = sr; knee_ = kneeDb;
    attackCoef_ = 1.0f - std::exp(-1.0f / (std::max(attackSec, 1e-4f) * sr));
    releaseCoef_ = 1.0f - std::exp(-1.0f / (std::max(releaseSec, 1e-3f) * sr));
  }
  void setParams(float thresholdDb, float ratio) {
    thr_ = thresholdDb; ratio_ = std::max(1.0f, ratio);
    makeupGain_ = std::pow(10.0f, (-0.6f * outDb(0.0f)) / 20.0f);
  }
  // Linear gain to apply for a detector key level (|x|). Lets a stereo pair
  // share one gain (linked detection, like the browser's compressor).
  inline float gain(float key) {
    const float ax = std::fabs(key) + 1e-9f;
    const float inDb = 20.0f * std::log10(ax);
    const float target = outDb(inDb) - inDb;  // <= 0
    const float coef = target < gr_ ? attackCoef_ : releaseCoef_;
    gr_ += coef * (target - gr_);
    return std::pow(10.0f, gr_ / 20.0f) * makeupGain_;
  }
  inline float process(float x) { return x * gain(x); }
  void reset() { gr_ = 0; }

 private:
  float outDb(float inDb) const {
    const float slope = 1.0f / ratio_ - 1.0f;
    if (inDb <= thr_) return inDb;
    if (knee_ <= 0.0f || inDb >= thr_ + knee_) {
      const float kneeOut = knee_ > 0.0f ? knee_ + slope * knee_ * 0.5f : 0.0f;
      return thr_ + kneeOut + (inDb - thr_ - (knee_ > 0.0f ? knee_ : 0.0f)) / ratio_;
    }
    const float d = inDb - thr_;
    return inDb + slope * d * d / (2.0f * knee_);
  }
  float sr_ = 48000, knee_ = 0, thr_ = 0, ratio_ = 1;
  float attackCoef_ = 0.01f, releaseCoef_ = 0.001f, gr_ = 0, makeupGain_ = 1;
};

// --------------------------------------------------------------- Shapers --
// Closed-form versions of the web app's 1024-point WaveShaper curves.
inline float gateShape(float x, float amount01) {
  const float th = amount01 * 0.10f;
  const float ax = std::fabs(x);
  if (ax < th) return 0.0f;
  return std::copysign((ax - th) / (1.0f - th), x);
}
inline float softClip(float x, float drive) {
  const float k = 1.0f + drive * 6.0f;
  x = std::max(-1.0f, std::min(1.0f, x));  // curve is clamped outside [-1,1]
  return std::tanh(x * k) / std::tanh(k);
}

// ----------------------------------------------------------------- Delay --
class DelayLine {
 public:
  void init(int maxSamples) {
    buf_.assign(static_cast<size_t>(maxSamples) + 4, 0.0f);
    pos_ = 0;
  }
  inline void write(float x) {
    buf_[pos_] = x;
    if (++pos_ >= buf_.size()) pos_ = 0;
  }
  // Delay measured back from the most recent write; linear interpolation.
  inline float read(float delaySamples) const {
    const int n = static_cast<int>(buf_.size());
    float rp = static_cast<float>(pos_) - 1.0f - delaySamples;
    while (rp < 0) rp += n;
    const int i0 = static_cast<int>(rp);
    const float frac = rp - i0;
    const float a = buf_[i0 % n], b = buf_[(i0 + 1) % n];
    return a + (b - a) * frac;
  }
  void reset() { std::fill(buf_.begin(), buf_.end(), 0.0f); }

 private:
  std::vector<float> buf_;
  size_t pos_ = 0;
};

// ------------------------------------------------------------------- FFT --
class FFT {
 public:
  explicit FFT(int n = 0) { if (n) init(n); }
  void init(int n) {
    n_ = n;
    cos_.resize(n / 2); sin_.resize(n / 2); rev_.resize(n);
    for (int i = 0; i < n / 2; i++) {
      cos_[i] = static_cast<float>(std::cos(2.0 * kPi * i / n));
      sin_[i] = static_cast<float>(std::sin(2.0 * kPi * i / n));
    }
    int bits = 0; while ((1 << bits) < n) bits++;
    for (int i = 0; i < n; i++) {
      int r = 0;
      for (int b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev_[i] = r;
    }
  }
  int size() const { return n_; }
  // In-place complex FFT. inverse=true also divides by n.
  void transform(float* re, float* im, bool inverse) const {
    for (int i = 0; i < n_; i++) {
      int j = rev_[i];
      if (j > i) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
    }
    for (int len = 2; len <= n_; len <<= 1) {
      const int half = len >> 1, step = n_ / len;
      for (int i = 0; i < n_; i += len) {
        for (int k = 0; k < half; k++) {
          const float wr = cos_[k * step];
          const float wi = inverse ? sin_[k * step] : -sin_[k * step];
          const int a = i + k, b = a + half;
          const float tr = re[b] * wr - im[b] * wi;
          const float ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr;        im[a] += ti;
        }
      }
    }
    if (inverse) {
      const float s = 1.0f / n_;
      for (int i = 0; i < n_; i++) { re[i] *= s; im[i] *= s; }
    }
  }

 private:
  int n_ = 0;
  std::vector<float> cos_, sin_;
  std::vector<int> rev_;
};

// ------------------------------------------------- Stereo IR convolution --
// Uniform-partitioned overlap-save convolution of one mono input with a
// two-channel impulse response (what ConvolverNode does for a mono source and
// a stereo IR). Output is delayed by one block (kBlock samples, ~10 ms) — fine
// for a reverb tail, and it costs about len/kBlock multiply-adds per sample
// instead of len.
class StereoConvolver {
 public:
  static constexpr int kBlock = 512;

  void init(const std::vector<float>& irL, const std::vector<float>& irR) {
    const int B = kBlock, N = 2 * B, bins = B + 1;
    fft_.init(N);
    const size_t len = std::max(irL.size(), irR.size());
    parts_ = static_cast<int>((len + B - 1) / B);
    if (parts_ < 1) parts_ = 1;
    for (int c = 0; c < 2; c++) {
      const std::vector<float>& ir = c == 0 ? irL : irR;
      irRe_[c].assign(static_cast<size_t>(parts_) * bins, 0.0f);
      irIm_[c].assign(static_cast<size_t>(parts_) * bins, 0.0f);
      std::vector<float> re(N), im(N);
      for (int p = 0; p < parts_; p++) {
        std::fill(re.begin(), re.end(), 0.0f); std::fill(im.begin(), im.end(), 0.0f);
        for (int i = 0; i < B; i++) {
          const size_t idx = static_cast<size_t>(p) * B + i;
          if (idx < ir.size()) re[i] = ir[idx];
        }
        fft_.transform(re.data(), im.data(), false);
        std::copy(re.begin(), re.begin() + bins, irRe_[c].begin() + static_cast<size_t>(p) * bins);
        std::copy(im.begin(), im.begin() + bins, irIm_[c].begin() + static_cast<size_t>(p) * bins);
      }
    }
    fdlRe_.assign(static_cast<size_t>(parts_) * bins, 0.0f);
    fdlIm_.assign(static_cast<size_t>(parts_) * bins, 0.0f);
    prev_.assign(B, 0.0f); cur_.assign(B, 0.0f);
    outL_.assign(B, 0.0f); outR_.assign(B, 0.0f);
    head_ = 0; pos_ = 0;
    accRe_.assign(N, 0.0f); accIm_.assign(N, 0.0f);
    tmpRe_.assign(N, 0.0f); tmpIm_.assign(N, 0.0f);
  }

  // One input sample in, one stereo sample out (delayed by kBlock samples).
  inline void tick(float x, float& l, float& r) {
    cur_[pos_] = x;
    l = outL_[pos_]; r = outR_[pos_];
    if (++pos_ == kBlock) { processBlock(); pos_ = 0; }
  }

  void reset() {
    std::fill(fdlRe_.begin(), fdlRe_.end(), 0.0f);
    std::fill(fdlIm_.begin(), fdlIm_.end(), 0.0f);
    std::fill(prev_.begin(), prev_.end(), 0.0f);
    std::fill(cur_.begin(), cur_.end(), 0.0f);
    std::fill(outL_.begin(), outL_.end(), 0.0f);
    std::fill(outR_.begin(), outR_.end(), 0.0f);
    pos_ = 0;
  }

 private:
  void processBlock() {
    const int B = kBlock, N = 2 * B, bins = B + 1;
    for (int i = 0; i < B; i++) { tmpRe_[i] = prev_[i]; tmpRe_[B + i] = cur_[i]; }
    std::fill(tmpIm_.begin(), tmpIm_.end(), 0.0f);
    fft_.transform(tmpRe_.data(), tmpIm_.data(), false);
    head_ = (head_ + parts_ - 1) % parts_;  // newest spectrum goes to slot head_
    std::copy(tmpRe_.begin(), tmpRe_.begin() + bins, fdlRe_.begin() + static_cast<size_t>(head_) * bins);
    std::copy(tmpIm_.begin(), tmpIm_.begin() + bins, fdlIm_.begin() + static_cast<size_t>(head_) * bins);

    for (int c = 0; c < 2; c++) {
      std::fill(accRe_.begin(), accRe_.begin() + bins, 0.0f);
      std::fill(accIm_.begin(), accIm_.begin() + bins, 0.0f);
      for (int p = 0; p < parts_; p++) {
        const float* xr = &fdlRe_[static_cast<size_t>((head_ + p) % parts_) * bins];
        const float* xi = &fdlIm_[static_cast<size_t>((head_ + p) % parts_) * bins];
        const float* hr = &irRe_[c][static_cast<size_t>(p) * bins];
        const float* hi = &irIm_[c][static_cast<size_t>(p) * bins];
        for (int k = 0; k < bins; k++) {
          accRe_[k] += xr[k] * hr[k] - xi[k] * hi[k];
          accIm_[k] += xr[k] * hi[k] + xi[k] * hr[k];
        }
      }
      // Rebuild the upper half by conjugate symmetry, then inverse FFT.
      for (int k = 1; k < B; k++) {
        accRe_[N - k] = accRe_[k];
        accIm_[N - k] = -accIm_[k];
      }
      fft_.transform(accRe_.data(), accIm_.data(), true);
      std::vector<float>& out = c == 0 ? outL_ : outR_;
      for (int i = 0; i < B; i++) out[i] = accRe_[B + i];  // valid half (overlap-save)
    }
    prev_ = cur_;
  }

  FFT fft_;
  int parts_ = 1, head_ = 0, pos_ = 0;
  std::vector<float> irRe_[2], irIm_[2];
  std::vector<float> fdlRe_, fdlIm_, prev_, cur_, outL_, outR_;
  std::vector<float> accRe_, accIm_, tmpRe_, tmpIm_;
};

// Same generator as the web app's makeReverbBuffer(): LCG noise through a
// lowpass that darkens along the tail, with an exponential-ish decay envelope.
// Returns the two channels already scaled by the browser's ConvolverNode
// "normalize" gain, so wet levels line up with the web version.
inline void makeReverbIR(float sr, float duration, float decay, int seedShift,
                         std::vector<float>& left, std::vector<float>& right) {
  const int length = static_cast<int>(std::floor(sr * duration));
  const int fadeIn = static_cast<int>(std::floor(sr * 0.003f));
  left.assign(length, 0.0f); right.assign(length, 0.0f);
  double sumSq = 0.0;
  for (int ch = 0; ch < 2; ch++) {
    std::vector<float>& data = ch == 0 ? left : right;
    int64_t seed = static_cast<int64_t>(ch) * 13 + seedShift;
    if (seed == 0) seed = 1;
    float lp = 0;
    for (int i = 0; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      const float n = (static_cast<float>(seed) / 2147483647.0f) * 2.0f - 1.0f;
      const float t = static_cast<float>(i) / length;
      const float alpha = lerpf(t, 0, 1, 0.9f, 0.12f);
      lp = lp + alpha * (n - lp);
      float env = std::pow(1.0f - t, decay);
      if (i < fadeIn) env *= static_cast<float>(i) / fadeIn;
      data[i] = lp * env * 1.6f;
      sumSq += static_cast<double>(data[i]) * data[i];
    }
  }
  // Chromium's ConvolverNode normalization: 1/RMS, times -58 dB calibration
  // (0.00125), times 44100/sampleRate.
  const double rms = std::sqrt(sumSq / (2.0 * length));
  if (rms > 0.000125) {
    const float scale = static_cast<float>((1.0 / rms) * 0.00125 * (44100.0 / sr));
    for (int i = 0; i < length; i++) { left[i] *= scale; right[i] *= scale; }
  }
}

}  // namespace gemstar
