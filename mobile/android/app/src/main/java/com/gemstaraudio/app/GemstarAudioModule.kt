package com.gemstaraudio.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.gemstaraudio.audio.GemstarEngine

/** JS-facing bridge to the native audio engine (NativeModules.GemstarAudio). */
class GemstarAudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "GemstarAudio"

    /** Mic permission must already be granted (JS asks via PermissionsAndroid). */
    @ReactMethod
    fun start(promise: Promise) {
        try {
            promise.resolve(GemstarEngine.start())
        } catch (e: Throwable) {
            promise.reject("ENGINE_START", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        GemstarEngine.stop()
        promise.resolve(null)
    }

    @ReactMethod
    fun setKnob(id: String, value: Double) = GemstarEngine.setKnob(id, value.toFloat())

    /** Bulk update, e.g. when a preset is picked: { clean: 45, punch: 65, ... } */
    @ReactMethod
    fun setKnobs(values: ReadableMap) {
        val it = values.keySetIterator()
        while (it.hasNextKey()) {
            val key = it.nextKey()
            GemstarEngine.setKnob(key, values.getDouble(key).toFloat())
        }
    }

    @ReactMethod
    fun setBypass(bypass: Boolean) = GemstarEngine.setBypass(bypass)

    @ReactMethod
    fun setOutputGainDb(db: Double) = GemstarEngine.setOutputGainDb(db.toFloat())

    @ReactMethod
    fun setScaleMask(mask: Int) = GemstarEngine.setScaleMask(mask)

    @ReactMethod
    fun getStatus(promise: Promise) {
        val m = Arguments.createMap()
        m.putBoolean("running", GemstarEngine.isRunning())
        m.putInt("sampleRate", GemstarEngine.sampleRate())
        m.putDouble("latencyMs", GemstarEngine.latencyMs().toDouble())
        promise.resolve(m)
    }

    /** Peak since last call, 0..1. Polled ~15x/sec by the meter. */
    @ReactMethod
    fun takePeak(promise: Promise) = promise.resolve(GemstarEngine.takePeak().toDouble())

    override fun invalidate() {
        GemstarEngine.stop()
        super.invalidate()
    }
}
