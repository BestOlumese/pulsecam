import { RppgEngine } from "../engine/rppgPipeline";
import type { RoiRgbSample, VitalTelemetry } from "../types/telemetry";

export type RppgWorkerInboundMessage =
  | { type: "sample"; payload: RoiRgbSample }
  | { type: "reset" };

interface RppgWorkerScope {
  postMessage(message: VitalTelemetry): void;
  onmessage: ((event: MessageEvent<RppgWorkerInboundMessage>) => void) | null;
}

const workerSelf = globalThis as unknown as RppgWorkerScope;
const engine = new RppgEngine();

workerSelf.onmessage = (event: MessageEvent<RppgWorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "reset") {
    workerSelf.postMessage(engine.reset());
    return;
  }

  if (message.type === "sample") {
    const telemetry = engine.processSample(message.payload);
    workerSelf.postMessage(telemetry);
  }
};
