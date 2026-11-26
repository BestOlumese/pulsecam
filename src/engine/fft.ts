export const FFT_SIZE = 1024;
const HALF_FFT = FFT_SIZE >> 1;

export interface FftPeakResult {
  peakHz: number;
  bpm: number;
  snrDb: number;
  sqiScore: number;
  valid: boolean;
}

/**
 * Fixed 1024-point Radix-2 Cooley-Tukey FFT with Hann windowing, zero-padding,
 * and log-magnitude parabolic peak interpolation for sub-0.1 BPM frequency resolution.
 * Pre-allocates all tables and working buffers for zero per-call GC pressure.
 */
export class Fft1024 {
  private readonly bitRev = new Uint16Array(FFT_SIZE);
  private readonly cosTable = new Float32Array(HALF_FFT);
  private readonly sinTable = new Float32Array(HALF_FFT);

  private readonly real = new Float32Array(FFT_SIZE);
  private readonly imag = new Float32Array(FFT_SIZE);
  readonly magnitudes = new Float32Array(HALF_FFT + 1);

  readonly result: FftPeakResult = {
    peakHz: 0,
    bpm: 0,
    snrDb: -20,
    sqiScore: 0,
    valid: false,
  };

  constructor() {
    const bits = Math.round(Math.log2(FFT_SIZE));
    for (let i = 0; i < FFT_SIZE; i++) {
      let x = i;
      let rev = 0;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      this.bitRev[i] = rev;
    }

    for (let k = 0; k < HALF_FFT; k++) {
      const angle = (-2 * Math.PI * k) / FFT_SIZE;
      this.cosTable[k] = Math.cos(angle);
      this.sinTable[k] = Math.sin(angle);
    }
  }

  /**
   * Computes the 1024-pt magnitude spectrum of `signal[0..length-1]` and locates the
   * dominant frequency peak within `[minHz, maxHz]`. Returns the reusable `result` object.
   */
  analyze(
    signal: Float32Array,
    length: number,
    sampleRateHz: number,
    minHz = 0.7,
    maxHz = 3.0
  ): FftPeakResult {
    const res = this.result;
    if (length < 16 || sampleRateHz <= 0) {
      res.peakHz = 0;
      res.bpm = 0;
      res.snrDb = -20;
      res.sqiScore = 0;
      res.valid = false;
      return res;
    }

    const usedLen = Math.min(length, FFT_SIZE);
    const real = this.real;
    const imag = this.imag;
    const bitRev = this.bitRev;

    // Compute mean for DC removal
    let sum = 0;
    for (let i = 0; i < usedLen; i++) {
      sum += signal[i];
    }
    const mean = sum / usedLen;

    // Clear buffers
    real.fill(0);
    imag.fill(0);

    // Apply Hann window + bit-reversed placement in a single pass
    const denom = usedLen > 1 ? usedLen - 1 : 1;
    const twoPiOverDenom = (2 * Math.PI) / denom;
    for (let i = 0; i < usedLen; i++) {
      const w = 0.5 * (1 - Math.cos(twoPiOverDenom * i));
      real[bitRev[i]] = (signal[i] - mean) * w;
    }

    // Iterative Radix-2 Cooley-Tukey butterflies
    const cosTable = this.cosTable;
    const sinTable = this.sinTable;
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const halfSize = size >> 1;
      const step = FFT_SIZE / size;
      for (let i = 0; i < FFT_SIZE; i += size) {
        let tableIdx = 0;
        for (let j = 0; j < halfSize; j++) {
          const even = i + j;
          const odd = even + halfSize;
          const wr = cosTable[tableIdx];
          const wi = sinTable[tableIdx];
          tableIdx += step;

          const tr = wr * real[odd] - wi * imag[odd];
          const ti = wr * imag[odd] + wi * real[odd];

          real[odd] = real[even] - tr;
          imag[odd] = imag[even] - ti;
          real[even] += tr;
          imag[even] += ti;
        }
      }
    }

    // Magnitude spectrum for non-negative frequencies
    const mags = this.magnitudes;
    for (let k = 0; k <= HALF_FFT; k++) {
      mags[k] = Math.hypot(real[k], imag[k]);
    }

    const binHz = sampleRateHz / FFT_SIZE;
    const minBin = Math.max(1, Math.floor(minHz / binHz));
    const maxBin = Math.min(HALF_FFT - 1, Math.ceil(maxHz / binHz));

    let peakBin = minBin;
    let peakMag = 0;
    let totalBandPower = 0;

    for (let k = minBin; k <= maxBin; k++) {
      const m = mags[k];
      totalBandPower += m * m;
      if (m > peakMag) {
        peakMag = m;
        peakBin = k;
      }
    }

    if (totalBandPower < 1e-12 || peakMag < 1e-6) {
      res.peakHz = 0;
      res.bpm = 0;
      res.snrDb = -20;
      res.sqiScore = 0;
      res.valid = false;
      return res;
    }

    // Log-magnitude 3-point parabolic interpolation around peakBin
    let delta = 0;
    if (peakBin > minBin && peakBin < maxBin) {
      const mPrev = mags[peakBin - 1];
      const mCurr = mags[peakBin];
      const mNext = mags[peakBin + 1];
      if (mPrev > 1e-12 && mCurr > 1e-12 && mNext > 1e-12) {
        const y0 = Math.log(mPrev);
        const y1 = Math.log(mCurr);
        const y2 = Math.log(mNext);
        const d = y0 - 2 * y1 + y2;
        if (Math.abs(d) > 1e-12) {
          delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d));
        }
      }
    }

    const peakHz = (peakBin + delta) * binHz;
    const bpm = peakHz * 60;

    // Spectral SNR: power within ±0.15 Hz of peak vs remaining HR band
    const peakHalfWidthBins = Math.max(1, Math.round(0.15 / binHz));
    const sigLo = Math.max(minBin, peakBin - peakHalfWidthBins);
    const sigHi = Math.min(maxBin, peakBin + peakHalfWidthBins);
    let signalPower = 0;
    for (let k = sigLo; k <= sigHi; k++) {
      const m = mags[k];
      signalPower += m * m;
    }
    const noisePower = Math.max(totalBandPower - signalPower, 1e-12);
    const snrDb = 10 * Math.log10(signalPower / noisePower);

    // Map SNR (-5 dB .. +10 dB) cleanly onto 0 .. 100 SQI scale
    const sqiScore = Math.round(
      Math.max(0, Math.min(100, ((snrDb + 5) / 15) * 100))
    );

    res.peakHz = peakHz;
    res.bpm = bpm;
    res.snrDb = snrDb;
    res.sqiScore = sqiScore;
    res.valid = peakHz >= minHz && peakHz <= maxHz;
    return res;
  }
}
