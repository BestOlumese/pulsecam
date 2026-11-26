import type { RoiRgbSample, VitalTelemetry } from "../types/telemetry";
import { Fft1024 } from "./fft";
import { BandpassFilter } from "./filter";
import { PosProjector } from "./pos";
import { RgbRingBuffer, fuseRoiRgb } from "./ringBuffer";

export interface RppgEngineOptions {
  /** Maximum ring-buffer capacity in samples (default 1024 = ~34s at 30 FPS). */
  maxSamples?: number;
  /** Sliding analysis window duration in ms (default 30_000 ms = 30s). */
  windowDurationMs?: number;
  /** Minimum elapsed window duration before emitting a locked BPM (default 5_000 ms). */
  minLockDurationMs?: number;
  /** Minimum sample count before emitting a locked BPM (default 90 samples). */
  minLockSamples?: number;
  /** Heart-rate bandpass lower cutoff in Hz (default 0.7 Hz = 42 BPM). */
  minHrHz?: number;
  /** Heart-rate bandpass upper cutoff in Hz (default 3.0 Hz = 180 BPM). */
  maxHrHz?: number;
  /** Minimum SQI (0–100) required to acquire initial BPM lock (default 18). */
  minLockSqi?: number;
  /** Lower SQI hysteresis threshold to retain an existing lock (default 10). */
  retainLockSqi?: number;
  /** Grace window in ms to hold last stable BPM during brief webcam hiccups (default 2_500 ms). */
  lockGraceMs?: number;
}

const DEFAULT_OPTIONS: Required<RppgEngineOptions> = {
  maxSamples: 1024,
  windowDurationMs: 20_000,
  minLockDurationMs: 6_000,
  minLockSamples: 64,
  minHrHz: 0.7,
  maxHrHz: 3.0,
  minLockSqi: 18,
  retainLockSqi: 10,
  lockGraceMs: 2_500,
};

export const IDLE_TELEMETRY: VitalTelemetry = {
  status: "idle",
  bpm: null,
  hrvRmssdMs: null,
  respiratoryRate: null,
  sqiScore: 0,
  skinToneCalibrationActive: false,
  ppgWaveValue: 0,
  guidanceMessage: "Position face within frame to begin",
};

/**
 * Pure TypeScript client-side rPPG DSP pipeline:
 * ROI RGB Fusion -> Sliding Ring Buffer (15–30s) -> POS Projection ->
 * 0.7–3.0 Hz Zero-Phase Bandpass -> 1024-pt FFT with Parabolic Peak Interpolation.
 */
export class RppgEngine {
  private readonly opts: Required<RppgEngineOptions>;
  private readonly ringBuffer: RgbRingBuffer;
  private readonly pos: PosProjector;
  private readonly hrBandpass: BandpassFilter;
  private readonly fft: Fft1024;

  // Reusable per-frame scratch buffers (zero GC in hot loop)
  private readonly fusedRgb = new Float32Array(3);
  private readonly winR: Float32Array;
  private readonly winG: Float32Array;
  private readonly winB: Float32Array;
  private readonly posRaw: Float32Array;
  private readonly ppgFiltered: Float32Array;

  private smoothedBpm: number | null = null;
  private smoothedSqi = 0;
  private lastGoodLockMs = -1;
  private lastBpmUpdateMs = -1;

  constructor(options?: RppgEngineOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    const cap = this.opts.maxSamples;

    this.ringBuffer = new RgbRingBuffer(cap);
    this.pos = new PosProjector(cap);
    this.hrBandpass = new BandpassFilter(
      this.opts.minHrHz,
      this.opts.maxHrHz,
      cap
    );
    this.fft = new Fft1024();

    this.winR = new Float32Array(cap);
    this.winG = new Float32Array(cap);
    this.winB = new Float32Array(cap);
    this.posRaw = new Float32Array(cap);
    this.ppgFiltered = new Float32Array(cap);
  }

  reset(): VitalTelemetry {
    this.ringBuffer.reset();
    this.smoothedBpm = null;
    this.smoothedSqi = 0;
    this.lastGoodLockMs = -1;
    this.lastBpmUpdateMs = -1;
    return { ...IDLE_TELEMETRY };
  }

  processSample(sample: RoiRgbSample): VitalTelemetry {
    const hasSignal = fuseRoiRgb(sample, this.fusedRgb);
    if (!hasSignal) {
      return {
        status: "calibrating",
        bpm: null,
        hrvRmssdMs: null,
        respiratoryRate: null,
        sqiScore: 0,
        skinToneCalibrationActive: false,
        ppgWaveValue: 0,
        guidanceMessage: "Position face within frame",
      };
    }

    this.ringBuffer.push(
      sample.timestampMs,
      this.fusedRgb[0],
      this.fusedRgb[1],
      this.fusedRgb[2]
    );

    const len = this.ringBuffer.copySlidingWindow(
      this.opts.windowDurationMs,
      this.winR,
      this.winG,
      this.winB
    );
    const fs = this.ringBuffer.lastSampleRateHz;
    const durationMs = this.ringBuffer.lastWindowDurationMs;

    let ppgWaveValue = 0;
    if (len >= 16) {
      this.pos.project(this.winR, this.winG, this.winB, len, fs, this.posRaw);
      this.hrBandpass.filter(this.posRaw, len, fs, this.ppgFiltered);
      ppgWaveValue = this.computeNormalizedWaveValue(len, fs);
    }

    if (
      len < this.opts.minLockSamples ||
      durationMs < this.opts.minLockDurationMs
    ) {
      const remainingSec = Math.max(
        1,
        Math.ceil((this.opts.minLockDurationMs - durationMs) / 1000)
      );
      return {
        status: "calibrating",
        bpm: null,
        hrvRmssdMs: null,
        respiratoryRate: null,
        sqiScore: 0,
        skinToneCalibrationActive: false,
        ppgWaveValue,
        guidanceMessage: `Calibrating signal (${remainingSec}s)...`,
      };
    }

    const peak = this.fft.analyze(
      this.ppgFiltered,
      len,
      fs,
      this.opts.minHrHz,
      this.opts.maxHrHz
    );

    // Smooth SQI slightly so single-frame noise jitter doesn't flicker status
    this.smoothedSqi =
      this.smoothedSqi === 0
        ? peak.sqiScore
        : 0.25 * peak.sqiScore + 0.75 * this.smoothedSqi;
    const reportedSqi = Math.round(this.smoothedSqi);

    const hasExistingLock = this.smoothedBpm !== null;
    const meetsLockThreshold = hasExistingLock
      ? reportedSqi >= this.opts.retainLockSqi
      : reportedSqi >= this.opts.minLockSqi;

    if (peak.valid && meetsLockThreshold) {
      this.lastGoodLockMs = sample.timestampMs;

      if (this.smoothedBpm === null) {
        this.smoothedBpm = peak.bpm;
      } else {
        // Slew-rate limit (max 6 BPM/sec) + EMA to prevent single-frame harmonic jumps
        const dtSec =
          this.lastBpmUpdateMs >= 0
            ? Math.max(0.01, (sample.timestampMs - this.lastBpmUpdateMs) / 1000)
            : 0.033;
        const maxDelta = Math.max(0.6, 6 * dtSec);
        const clampedTarget =
          this.smoothedBpm +
          Math.max(-maxDelta, Math.min(maxDelta, peak.bpm - this.smoothedBpm));
        this.smoothedBpm = 0.25 * clampedTarget + 0.75 * this.smoothedBpm;
      }
      this.lastBpmUpdateMs = sample.timestampMs;

      return {
        status: "locked",
        bpm: Math.round(this.smoothedBpm * 10) / 10,
        hrvRmssdMs: null,
        respiratoryRate: null,
        sqiScore: reportedSqi,
        skinToneCalibrationActive: false,
        ppgWaveValue,
        guidanceMessage: "Signal locked — hold steady",
      };
    }

    // Hysteresis grace window: hold last locked BPM during brief (< 2.5s) webcam dips
    if (
      this.smoothedBpm !== null &&
      this.lastGoodLockMs >= 0 &&
      sample.timestampMs - this.lastGoodLockMs <= this.opts.lockGraceMs
    ) {
      return {
        status: "locked",
        bpm: Math.round(this.smoothedBpm * 10) / 10,
        hrvRmssdMs: null,
        respiratoryRate: null,
        sqiScore: reportedSqi,
        skinToneCalibrationActive: false,
        ppgWaveValue,
        guidanceMessage: "Signal locked — hold steady",
      };
    }

    this.smoothedBpm = null;
    return {
      status: "calibrating",
      bpm: null,
      hrvRmssdMs: null,
      respiratoryRate: null,
      sqiScore: reportedSqi,
      skinToneCalibrationActive: false,
      ppgWaveValue,
      guidanceMessage: "Stabilizing pulse signal — face light & hold still",
    };
  }

  private computeNormalizedWaveValue(length: number, sampleRateHz: number): number {
    const tail = Math.min(length, Math.max(16, Math.round(sampleRateHz * 3)));
    const start = length - tail;
    let sumSq = 0;
    for (let i = start; i < length; i++) {
      const v = this.ppgFiltered[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / tail);
    if (rms < 1e-7) {
      return 0;
    }
    const normalized = this.ppgFiltered[length - 1] / (rms * 2.5);
    return Math.max(-1, Math.min(1, normalized));
  }
}
