import type { RoiRgbSample, VitalTelemetry } from "../types/telemetry";

export type RppgWorkerInboundMessage =
  | { type: "sample"; payload: RoiRgbSample }
  | { type: "reset" };

interface RppgWorkerScope {
  postMessage(message: VitalTelemetry): void;
  onmessage: ((event: MessageEvent<RppgWorkerInboundMessage>) => void) | null;
}

const IDLE_TELEMETRY: VitalTelemetry = {
  status: "idle",
  bpm: null,
  hrvRmssdMs: null,
  respiratoryRate: null,
  sqiScore: 0,
  skinToneCalibrationActive: false,
  ppgWaveValue: 0,
  guidanceMessage: "Position face within frame to begin",
};

const workerSelf = globalThis as unknown as RppgWorkerScope;

workerSelf.onmessage = (event: MessageEvent<RppgWorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "reset") {
    workerSelf.postMessage({ ...IDLE_TELEMETRY });
    return;
  }

  if (message.type === "sample") {
    // Phase 0 scaffold: Phase 1 will plug in ring buffer, POS projection,
    // 0.7–3.0 Hz bandpass filter, and 1024-pt FFT here.
    const telemetry: VitalTelemetry = {
      status: "calibrating",
      bpm: null,
      hrvRmssdMs: null,
      respiratoryRate: null,
      sqiScore: 0,
      skinToneCalibrationActive: false,
      ppgWaveValue: 0,
      guidanceMessage: "Calibrating signal...",
    };

    workerSelf.postMessage(telemetry);
  }
};
