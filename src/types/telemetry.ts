export interface RoiRgbSample {
  timestampMs: number;
  forehead: [number, number, number];
  leftCheek: [number, number, number];
  rightCheek: [number, number, number];
  headVelocity: number;
}

export type SignalStatus =
  | "idle"
  | "calibrating"
  | "low_light"
  | "motion_detected"
  | "locked";

export interface VitalTelemetry {
  status: SignalStatus;
  bpm: number | null;
  hrvRmssdMs: number | null;
  respiratoryRate: number | null;
  sqiScore: number;
  skinToneCalibrationActive: boolean;
  ppgWaveValue: number;
  guidanceMessage: string;
}