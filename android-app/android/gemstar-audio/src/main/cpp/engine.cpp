// Real-time audio engine: microphone (or USB/MIDI-class audio interface) in ->
// Gemstar vocal chain -> speakers/headphones out, via Oboe full-duplex.
// JNI entry points at the bottom are called from GemstarEngine.kt.
#include <jni.h>
#include <oboe/Oboe.h>

#include <android/log.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "dsp/vocal_chain.h"

#define LOG_TAG "GemstarEngine"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using namespace gemstar;

class Engine : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
 public:
  // ---- control surface (any thread) ----
  void setKnob(int index, float value) {
    if (index >= 0 && index < Knobs::kCount) knobs_[index].store(value, std::memory_order_relaxed);
  }
  void setBypass(bool b) { bypass_.store(b, std::memory_order_relaxed); }
  void setOutputGainDb(float db) { gainDb_.store(db, std::memory_order_relaxed); }
  void setScaleMask(int mask12) { scaleMask_.store(mask12, std::memory_order_relaxed); }
  float takePeak() { return peak_.exchange(0.0f, std::memory_order_relaxed); }
  int sampleRate() const { return sampleRate_; }
  bool running() const { return running_.load(); }
  float latencyMs() const {
    if (!out_) return -1;
    auto r = out_->calculateLatencyMillis();
    return r ? static_cast<float>(r.value()) : -1.0f;
  }

  bool start() {
    std::lock_guard<std::mutex> lock(mu_);
    if (running_) return true;
    oboe::AudioStreamBuilder ob;
    ob.setDirection(oboe::Direction::Output)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Exclusive)
        ->setFormat(oboe::AudioFormat::Float)
        ->setChannelCount(oboe::ChannelCount::Stereo)
        ->setUsage(oboe::Usage::Media)
        ->setDataCallback(std::shared_ptr<oboe::AudioStreamDataCallback>(
            this, [](oboe::AudioStreamDataCallback*) {}))  // engine is a process-lifetime singleton
        ->setErrorCallback(std::shared_ptr<oboe::AudioStreamErrorCallback>(
            this, [](oboe::AudioStreamErrorCallback*) {}));
    if (ob.openStream(out_) != oboe::Result::OK) { LOGE("output open failed"); return false; }

    oboe::AudioStreamBuilder ib;
    ib.setDirection(oboe::Direction::Input)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Exclusive)
        ->setFormat(oboe::AudioFormat::Float)
        ->setChannelCount(oboe::ChannelCount::Mono)
        ->setSampleRate(out_->getSampleRate())
        ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
        ->setInputPreset(oboe::InputPreset::Unprocessed);  // raw mic: Gemstar does the processing
    if (ib.openStream(in_) != oboe::Result::OK) {
      LOGE("input open failed (mic permission?)");
      out_->close(); out_.reset();
      return false;
    }

    sampleRate_ = out_->getSampleRate();
    chain_.init(static_cast<float>(sampleRate_));
    outStage_.init(static_cast<float>(sampleRate_));
    // Small-burst buffering keeps latency low; grow if the device underruns.
    out_->setBufferSizeInFrames(out_->getFramesPerBurst() * 2);
    inScratch_.assign(4096, 0.0f);

    if (in_->requestStart() != oboe::Result::OK || out_->requestStart() != oboe::Result::OK) {
      LOGE("stream start failed");
      closeStreams();
      return false;
    }
    running_ = true;
    LOGI("started: %d Hz, burst %d", sampleRate_, out_->getFramesPerBurst());
    return true;
  }

  void stop() {
    std::lock_guard<std::mutex> lock(mu_);
    closeStreams();
    running_ = false;
  }

  // ---- audio thread ----
  oboe::DataCallbackResult onAudioReady(oboe::AudioStream*, void* audioData, int32_t numFrames) override {
    float* out = static_cast<float*>(audioData);
    const int frames = std::min<int>(numFrames, static_cast<int>(inScratch_.size()));

    // Non-blocking mic read; any shortfall is zero-filled (brief silence beats a glitch).
    int got = 0;
    if (in_) {
      auto r = in_->read(inScratch_.data(), frames, 0);
      if (r) got = r.value();
    }
    for (int i = got; i < frames; i++) inScratch_[i] = 0.0f;

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

    float pk = 0;
    for (int i = 0; i < frames; i++) {
      float l, r;
      chain_.process(inScratch_[i], l, r);
      outStage_.process(l, r);
      out[2 * i] = l; out[2 * i + 1] = r;
      pk = std::max(pk, std::max(std::fabs(l), std::fabs(r)));
    }
    for (int i = frames; i < numFrames; i++) { out[2 * i] = 0; out[2 * i + 1] = 0; }
    float prev = peak_.load(std::memory_order_relaxed);
    if (pk > prev) peak_.store(pk, std::memory_order_relaxed);
    return oboe::DataCallbackResult::Continue;
  }

  // Headphones unplugged / device change: restart on the new route.
  void onErrorAfterClose(oboe::AudioStream*, oboe::Result error) override {
    if (error == oboe::Result::ErrorDisconnected && running_) {
      LOGI("stream disconnected, restarting");
      std::thread([this] { stop(); start(); }).detach();
    }
  }

 private:
  void closeStreams() {
    if (in_) { in_->stop(); in_->close(); in_.reset(); }
    if (out_) { out_->stop(); out_->close(); out_.reset(); }
  }

  std::mutex mu_;
  std::shared_ptr<oboe::AudioStream> in_, out_;
  VocalChain chain_;
  OutputStage outStage_;
  std::vector<float> inScratch_;
  std::atomic<float> knobs_[Knobs::kCount] = {};
  std::atomic<bool> bypass_{false}, running_{false};
  std::atomic<float> gainDb_{3.0f}, peak_{0.0f};
  std::atomic<int> scaleMask_{0};
  int appliedMask_ = 0;
  int sampleRate_ = 48000;
};

static Engine& engine() { static Engine e; return e; }

extern "C" {
JNIEXPORT jboolean JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nStart(JNIEnv*, jobject) { return engine().start(); }
JNIEXPORT void JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nStop(JNIEnv*, jobject) { engine().stop(); }
JNIEXPORT void JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nSetKnob(JNIEnv*, jobject, jint i, jfloat v) { engine().setKnob(i, v); }
JNIEXPORT void JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nSetBypass(JNIEnv*, jobject, jboolean b) { engine().setBypass(b); }
JNIEXPORT void JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nSetOutputGainDb(JNIEnv*, jobject, jfloat db) { engine().setOutputGainDb(db); }
JNIEXPORT void JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nSetScaleMask(JNIEnv*, jobject, jint m) { engine().setScaleMask(m); }
JNIEXPORT jfloat JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nTakePeak(JNIEnv*, jobject) { return engine().takePeak(); }
JNIEXPORT jint JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nSampleRate(JNIEnv*, jobject) { return engine().sampleRate(); }
JNIEXPORT jfloat JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nLatencyMs(JNIEnv*, jobject) { return engine().latencyMs(); }
JNIEXPORT jboolean JNICALL Java_com_gemstaraudio_audio_GemstarEngine_nIsRunning(JNIEnv*, jobject) { return engine().running(); }
}
