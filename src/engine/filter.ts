interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const MAX_PAD = 32;

function computeButterworthLowPass(
  cutoffHz: number,
  sampleRateHz: number,
  out: BiquadCoeffs
): void {
  const safeFc = Math.min(cutoffHz, sampleRateHz * 0.45);
  const omega = (2 * Math.PI * safeFc) / sampleRateHz;
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const alpha = sinW / Math.SQRT2;
  const a0 = 1 + alpha;

  out.b0 = ((1 - cosW) * 0.5) / a0;
  out.b1 = (1 - cosW) / a0;
  out.b2 = out.b0;
  out.a1 = (-2 * cosW) / a0;
  out.a2 = (1 - alpha) / a0;
}

function computeButterworthHighPass(
  cutoffHz: number,
  sampleRateHz: number,
  out: BiquadCoeffs
): void {
  const safeFc = Math.max(0.01, Math.min(cutoffHz, sampleRateHz * 0.45));
  const omega = (2 * Math.PI * safeFc) / sampleRateHz;
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const alpha = sinW / Math.SQRT2;
  const a0 = 1 + alpha;

  out.b0 = ((1 + cosW) * 0.5) / a0;
  out.b1 = -(1 + cosW) / a0;
  out.b2 = out.b0;
  out.a1 = (-2 * cosW) / a0;
  out.a2 = (1 - alpha) / a0;
}

function runBiquadForward(
  input: Float32Array,
  output: Float32Array,
  length: number,
  c: BiquadCoeffs
): void {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = c;

  for (let i = 0; i < length; i++) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    output[i] = y;
  }
}

function runBiquadBackward(
  input: Float32Array,
  output: Float32Array,
  length: number,
  c: BiquadCoeffs
): void {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = c;

  for (let i = length - 1; i >= 0; i--) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    output[i] = y;
  }
}

/**
 * Zero-phase cascaded Butterworth bandpass filter (forward-backward biquads)
 * with odd-symmetric edge reflection to suppress boundary ringing.
 * Default band: 0.7–3.0 Hz (42–180 BPM). Reusable for 0.1–0.4 Hz respiration in Phase 3.
 */
export class BandpassFilter {
  readonly lowCutHz: number;
  readonly highCutHz: number;

  private readonly hpf: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private readonly lpf: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private cachedFs = -1;

  private readonly scratchA: Float32Array;
  private readonly scratchB: Float32Array;

  constructor(lowCutHz = 0.7, highCutHz = 3.0, maxSamples = 900) {
    this.lowCutHz = lowCutHz;
    this.highCutHz = highCutHz;
    const scratchSize = maxSamples + MAX_PAD * 2;
    this.scratchA = new Float32Array(scratchSize);
    this.scratchB = new Float32Array(scratchSize);
  }

  private ensureCoefficients(sampleRateHz: number): void {
    if (Math.abs(sampleRateHz - this.cachedFs) < 0.01) {
      return;
    }
    computeButterworthHighPass(this.lowCutHz, sampleRateHz, this.hpf);
    computeButterworthLowPass(this.highCutHz, sampleRateHz, this.lpf);
    this.cachedFs = sampleRateHz;
  }

  /**
   * Filters `input[0..length-1]` into `output[0..length-1]` with zero phase shift.
   * Safe when `input === output`.
   */
  filter(
    input: Float32Array,
    length: number,
    sampleRateHz: number,
    output: Float32Array
  ): void {
    if (length < 4) {
      for (let i = 0; i < length; i++) {
        output[i] = input[i];
      }
      return;
    }

    this.ensureCoefficients(sampleRateHz);

    const pad = Math.min(MAX_PAD, length - 1);
    const totalLen = length + pad * 2;
    const a = this.scratchA;
    const b = this.scratchB;

    // Odd-symmetric edge reflection padding
    const first = input[0];
    const last = input[length - 1];
    for (let i = 0; i < pad; i++) {
      a[i] = 2 * first - input[pad - i];
    }
    for (let i = 0; i < length; i++) {
      a[pad + i] = input[i];
    }
    for (let i = 0; i < pad; i++) {
      a[pad + length + i] = 2 * last - input[length - 2 - i];
    }

    // Zero-phase HPF then zero-phase LPF (effective 4th-order bandpass)
    runBiquadForward(a, b, totalLen, this.hpf);
    runBiquadBackward(b, a, totalLen, this.hpf);
    runBiquadForward(a, b, totalLen, this.lpf);
    runBiquadBackward(b, a, totalLen, this.lpf);

    for (let i = 0; i < length; i++) {
      output[i] = a[pad + i];
    }
  }
}
