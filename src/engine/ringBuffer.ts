import type { RoiRgbSample } from "../types/telemetry";

const FOREHEAD_WEIGHT = 0.4;
const LEFT_CHEEK_WEIGHT = 0.3;
const RIGHT_CHEEK_WEIGHT = 0.3;

/**
 * Spatial fusion of forehead and cheek RGB means into a single 3-element output buffer.
 * Gracefully skips any zeroed/unavailable ROI so missing landmarks do not distort luminance.
 */
export function fuseRoiRgb(sample: RoiRgbSample, outRgb: Float32Array): boolean {
  const f = sample.forehead;
  const l = sample.leftCheek;
  const r = sample.rightCheek;

  let wSum = 0;
  let rAcc = 0;
  let gAcc = 0;
  let bAcc = 0;

  if (f[0] + f[1] + f[2] > 0) {
    wSum += FOREHEAD_WEIGHT;
    rAcc += f[0] * FOREHEAD_WEIGHT;
    gAcc += f[1] * FOREHEAD_WEIGHT;
    bAcc += f[2] * FOREHEAD_WEIGHT;
  }
  if (l[0] + l[1] + l[2] > 0) {
    wSum += LEFT_CHEEK_WEIGHT;
    rAcc += l[0] * LEFT_CHEEK_WEIGHT;
    gAcc += l[1] * LEFT_CHEEK_WEIGHT;
    bAcc += l[2] * LEFT_CHEEK_WEIGHT;
  }
  if (r[0] + r[1] + r[2] > 0) {
    wSum += RIGHT_CHEEK_WEIGHT;
    rAcc += r[0] * RIGHT_CHEEK_WEIGHT;
    gAcc += r[1] * RIGHT_CHEEK_WEIGHT;
    bAcc += r[2] * RIGHT_CHEEK_WEIGHT;
  }

  if (wSum <= 0) {
    outRgb[0] = 0;
    outRgb[1] = 0;
    outRgb[2] = 0;
    return false;
  }

  const invW = 1 / wSum;
  outRgb[0] = rAcc * invW;
  outRgb[1] = gAcc * invW;
  outRgb[2] = bAcc * invW;
  return true;
}

/**
 * Fixed-capacity circular buffer storing timestamped RGB means with zero per-frame allocation.
 * Uses Float64Array for timestamps so millisecond precision is preserved for epoch or high-res clocks.
 */
export class RgbRingBuffer {
  readonly capacity: number;
  private readonly timestamps: Float64Array;
  private readonly rBuf: Float32Array;
  private readonly gBuf: Float32Array;
  private readonly bBuf: Float32Array;

  private writeIndex = 0;
  private count = 0;

  lastSampleRateHz = 30;
  lastWindowDurationMs = 0;

  constructor(capacity = 900) {
    this.capacity = capacity;
    this.timestamps = new Float64Array(capacity);
    this.rBuf = new Float32Array(capacity);
    this.gBuf = new Float32Array(capacity);
    this.bBuf = new Float32Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  reset(): void {
    this.writeIndex = 0;
    this.count = 0;
    this.lastSampleRateHz = 30;
    this.lastWindowDurationMs = 0;
  }

  push(timestampMs: number, r: number, g: number, b: number): void {
    this.timestamps[this.writeIndex] = timestampMs;
    this.rBuf[this.writeIndex] = r;
    this.gBuf[this.writeIndex] = g;
    this.bBuf[this.writeIndex] = b;

    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count += 1;
    }
  }

  /**
   * Copies up to `maxWindowMs` of the most recent chronological samples resampled
   * onto a uniform time grid via linear interpolation. Eliminates spectral smearing
   * caused by real-world webcam / MediaPipe frame-interval jitter.
   * Updates `lastSampleRateHz` and `lastWindowDurationMs` without allocating.
   */
  copySlidingWindow(
    maxWindowMs: number,
    outR: Float32Array,
    outG: Float32Array,
    outB: Float32Array
  ): number {
    if (this.count === 0) {
      this.lastWindowDurationMs = 0;
      return 0;
    }

    const cap = this.capacity;
    const newestIdx = (this.writeIndex - 1 + cap) % cap;
    const newestTs = this.timestamps[newestIdx];
    const cutoffTs = newestTs - maxWindowMs;
    const maxCopy = Math.min(this.count, outR.length, outG.length, outB.length);

    // Walk backward from newest to find the start of the time window
    let rawLen = 1;
    while (rawLen < maxCopy) {
      const idx = (newestIdx - rawLen + cap) % cap;
      if (this.timestamps[idx] < cutoffTs) {
        break;
      }
      rawLen += 1;
    }

    const oldestIdx = (newestIdx - (rawLen - 1) + cap) % cap;
    const oldestTs = this.timestamps[oldestIdx];
    const durationMs = newestTs - oldestTs;
    this.lastWindowDurationMs = durationMs > 0 ? durationMs : 0;

    if (rawLen < 2 || durationMs <= 0) {
      outR[0] = this.rBuf[oldestIdx];
      outG[0] = this.gBuf[oldestIdx];
      outB[0] = this.bBuf[oldestIdx];
      return 1;
    }

    const rawHz = ((rawLen - 1) * 1000) / durationMs;
    const clampedHz = Math.min(120, Math.max(5, rawHz));
    this.lastSampleRateHz = clampedHz;

    // Resample onto an exact uniform grid spanning [oldestTs, newestTs] with `rawLen` points
    const dtMs = durationMs / (rawLen - 1);
    let cursor = 0; // Index within [0 .. rawLen - 2]

    for (let i = 0; i < rawLen; i++) {
      const targetTs = oldestTs + i * dtMs;

      while (cursor < rawLen - 2) {
        const nextRingIdx = (oldestIdx + cursor + 1) % cap;
        if (this.timestamps[nextRingIdx] >= targetTs) {
          break;
        }
        cursor += 1;
      }

      const idx0 = (oldestIdx + cursor) % cap;
      const idx1 = (oldestIdx + cursor + 1) % cap;
      const t0 = this.timestamps[idx0];
      const t1 = this.timestamps[idx1];
      const span = t1 - t0;
      const frac =
        span > 1e-6 ? Math.max(0, Math.min(1, (targetTs - t0) / span)) : 0;

      outR[i] = this.rBuf[idx0] + (this.rBuf[idx1] - this.rBuf[idx0]) * frac;
      outG[i] = this.gBuf[idx0] + (this.gBuf[idx1] - this.gBuf[idx0]) * frac;
      outB[i] = this.bBuf[idx0] + (this.bBuf[idx1] - this.bBuf[idx0]) * frac;
    }

    return rawLen;
  }
}
