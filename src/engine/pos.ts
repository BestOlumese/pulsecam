/**
 * Plane-Orthogonal-to-Skin (POS) projection (Wang et al., IEEE TBME 2017).
 * Suppresses specular reflections and uniform illumination changes by projecting
 * temporally normalized RGB signals onto a plane orthogonal to the skin-tone vector.
 * Reuses internal scratch arrays to eliminate per-frame garbage collection.
 */
export class PosProjector {
  private readonly s1: Float32Array;
  private readonly s2: Float32Array;
  private readonly hitCounts: Uint16Array;

  constructor(maxSamples = 900) {
    this.s1 = new Float32Array(maxSamples);
    this.s2 = new Float32Array(maxSamples);
    this.hitCounts = new Uint16Array(maxSamples);
  }

  /**
   * Projects chronological RGB buffers of `length` samples into `outPpg`.
   * Uses a 1.6-second overlap-add temporal window per the original POS specification.
   */
  project(
    r: Float32Array,
    g: Float32Array,
    b: Float32Array,
    length: number,
    sampleRateHz: number,
    outPpg: Float32Array
  ): void {
    if (length === 0) {
      return;
    }

    for (let i = 0; i < length; i++) {
      outPpg[i] = 0;
      this.hitCounts[i] = 0;
    }

    // Standard POS overlap-add window: ~1.6 seconds
    const windowLen = Math.max(
      4,
      Math.min(length, Math.round(1.6 * sampleRateHz))
    );
    const invWindowLen = 1 / windowLen;
    const s1 = this.s1;
    const s2 = this.s2;
    const hitCounts = this.hitCounts;

    for (let start = 0; start <= length - windowLen; start++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (let k = 0; k < windowLen; k++) {
        const idx = start + k;
        sumR += r[idx];
        sumG += g[idx];
        sumB += b[idx];
      }

      const meanR = sumR * invWindowLen;
      const meanG = sumG * invWindowLen;
      const meanB = sumB * invWindowLen;

      if (meanR < 1e-6 || meanG < 1e-6 || meanB < 1e-6) {
        continue;
      }

      const invR = 1 / meanR;
      const invG = 1 / meanG;
      const invB = 1 / meanB;

      let sum1 = 0;
      let sum2 = 0;

      for (let k = 0; k < windowLen; k++) {
        const idx = start + k;
        const rn = r[idx] * invR - 1;
        const gn = g[idx] * invG - 1;
        const bn = b[idx] * invB - 1;

        const v1 = gn - bn;
        const v2 = -2 * rn + gn + bn;
        s1[k] = v1;
        s2[k] = v2;
        sum1 += v1;
        sum2 += v2;
      }

      const mean1 = sum1 * invWindowLen;
      const mean2 = sum2 * invWindowLen;

      let var1 = 0;
      let var2 = 0;
      for (let k = 0; k < windowLen; k++) {
        const d1 = s1[k] - mean1;
        const d2 = s2[k] - mean2;
        var1 += d1 * d1;
        var2 += d2 * d2;
      }

      const std1 = Math.sqrt(var1 * invWindowLen);
      const std2 = Math.sqrt(var2 * invWindowLen);
      const alpha = std2 > 1e-8 ? std1 / std2 : 0;
      const hMean = mean1 + alpha * mean2;

      for (let k = 0; k < windowLen; k++) {
        const idx = start + k;
        outPpg[idx] += s1[k] + alpha * s2[k] - hMean;
        hitCounts[idx] += 1;
      }
    }

    // Normalize by overlap count so boundary samples match interior scale
    for (let i = 0; i < length; i++) {
      const c = hitCounts[i];
      if (c > 0) {
        outPpg[i] /= c;
      }
    }
  }
}
