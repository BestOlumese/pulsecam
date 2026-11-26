# Shared Data Contracts (`src/types/telemetry.ts`)

Both devs code strictly against these interfaces so Engine and UI integrate cleanly:

```ts
export interface RoiRgbSample {
  timestampMs: number;
  forehead: [number, number, number]; // Mean R, G, B
  leftCheek: [number, number, number];
  rightCheek: [number, number, number];
  headVelocity: number;               // Landmark delta for motion gating
}

export type SignalStatus = "idle" | "calibrating" | "low_light" | "motion_detected" | "locked";

export interface VitalTelemetry {
  status: SignalStatus;
  bpm: number | null;                 // Null when gated (low SQI)
  hrvRmssdMs: number | null;
  respiratoryRate: number | null;
  sqiScore: number;                   // 0 to 100
  skinToneCalibrationActive: boolean; // CIE-Lab ITA adaptive gain flag
  ppgWaveValue: number;               // Normalized value for live canvas
  guidanceMessage: string;            // e.g., "Hold still" or "Signal locked"
}