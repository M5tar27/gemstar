package com.gemstaraudio.audio

/**
 * Thin Kotlin wrapper over the native (C++/Oboe) vocal-chain engine.
 *
 * Knob indices are the same 14 knobs as the web app. The order must match
 * `struct Knobs` in dsp/vocal_chain.h.
 */
object GemstarEngine {
    val KNOBS = listOf(
        "clean", "punch", "bass", "voice", "highs", "smooth", "tune",
        "space", "wide", "radio", "m5tar", "jewels", "humanize", "delay",
    )

    init {
        System.loadLibrary("gemstar_audio")
    }

    fun knobIndex(id: String): Int = KNOBS.indexOf(id)

    fun start(): Boolean = nStart()
    fun stop() = nStop()
    fun isRunning(): Boolean = nIsRunning()

    /** value: 0..100, same scale as the web knobs. */
    fun setKnob(id: String, value: Float) {
        val i = knobIndex(id)
        if (i >= 0) nSetKnob(i, value.coerceIn(0f, 100f))
    }

    fun setBypass(bypass: Boolean) = nSetBypass(bypass)
    fun setOutputGainDb(db: Float) = nSetOutputGainDb(db.coerceIn(-24f, 12f))

    /** Bit i set = pitch class i (0 = C) is in the scale; 0 = chromatic. */
    fun setScaleMask(mask: Int) = nSetScaleMask(mask and 0xFFF)

    /** Highest output sample since the last call (0..1), for the level meter. */
    fun takePeak(): Float = nTakePeak()
    fun sampleRate(): Int = nSampleRate()
    fun latencyMs(): Float = nLatencyMs()

    private external fun nStart(): Boolean
    private external fun nStop()
    private external fun nSetKnob(index: Int, value: Float)
    private external fun nSetBypass(bypass: Boolean)
    private external fun nSetOutputGainDb(db: Float)
    private external fun nSetScaleMask(mask: Int)
    private external fun nTakePeak(): Float
    private external fun nSampleRate(): Int
    private external fun nLatencyMs(): Float
    private external fun nIsRunning(): Boolean
}
