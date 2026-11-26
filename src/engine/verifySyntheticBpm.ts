/**
 * Phase 1 (Dev 1) Synthetic Verification Script
 * Feeds synthetic pulsatile RGB sine waves directly into `src/workers/rppg.worker.ts`
 * via the Web Worker message interface (`onmessage` / `postMessage`) and asserts
 * heart rate accuracy within ±1.0 BPM (primary target: 72 BPM).
 *
 * Run with: node src/engine/verifySyntheticBpm.ts
 */

import { register } from "node:module";
import type { RoiRgbSample, VitalTelemetry } from "../types/telemetry";
import type { RppgWorkerInboundMessage } from "../workers/rppg.worker";

// Enable extensionless `.ts` resolution for Next.js/bundler-style imports under Node 22+/24+
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !specifier.endsWith(".ts")) {
          return await nextResolve(specifier + ".ts", context);
        }
        throw err;
      }
    }
  `)}`
);

interface MockWorkerGlobal {
  postMessage: (msg: VitalTelemetry) => void;
  onmessage: ((event: MessageEvent<RppgWorkerInboundMessage>) => void) | null;
}

const mockGlobal = globalThis as unknown as MockWorkerGlobal;
const emitted: VitalTelemetry[] = [];

mockGlobal.postMessage = (msg: VitalTelemetry) => {
  emitted.push(msg);
};

function dispatchToWorker(message: RppgWorkerInboundMessage): VitalTelemetry {
  if (!mockGlobal.onmessage) {
    throw new Error("Worker did not register globalThis.onmessage");
  }
  const before = emitted.length;
  mockGlobal.onmessage({ data: message } as MessageEvent<RppgWorkerInboundMessage>);
  if (emitted.length === before) {
    throw new Error(`Worker did not post telemetry for message type "${message.type}"`);
  }
  return emitted[emitted.length - 1];
}

function generateSyntheticSample(
  tSec: number,
  targetBpm: number,
  options: { illuminationDrift?: boolean; noiseAmp?: number } = {}
): RoiRgbSample {
  const hrHz = targetBpm / 60;
  const pulse = Math.sin(2 * Math.PI * hrHz * tSec);

  // Common-mode illumination drift (0.25 Hz) that POS projection must cancel out
  const drift = options.illuminationDrift
    ? 1 + 0.04 * Math.sin(2 * Math.PI * 0.25 * tSec)
    : 1;

  // Deterministic pseudo-noise (keeps test 100% reproducible)
  const noise = options.noiseAmp
    ? options.noiseAmp *
      Math.sin(2 * Math.PI * 6.7 * tSec + 0.3) *
      Math.cos(2 * Math.PI * 4.3 * tSec)
    : 0;

  // Realistic hemoglobin absorption modulation across R, G, B channels
  const baseR = 165;
  const baseG = 122;
  const baseB = 98;

  const r = baseR * drift * (1 - 0.002 * pulse) + noise;
  const g = baseG * drift * (1 - 0.01 * pulse) + noise;
  const b = baseB * drift * (1 - 0.004 * pulse) + noise;

  return {
    timestampMs: Math.round(tSec * 1000),
    forehead: [r, g, b],
    leftCheek: [r * 0.98, g * 0.99, b * 0.97],
    rightCheek: [r * 1.01, g * 1.0, b * 1.02],
    headVelocity: 0,
  };
}

interface Scenario {
  label: string;
  targetBpm: number;
  fps: number;
  durationSec: number;
  illuminationDrift?: boolean;
  noiseAmp?: number;
}

async function main(): Promise<void> {
  // Dynamically load the worker after setting up globalThis.postMessage
  await import("../workers/rppg.worker");

  const scenarios: Scenario[] = [
    {
      label: "72 BPM clean sine wave (30 FPS, 20s)",
      targetBpm: 72,
      fps: 30,
      durationSec: 20,
    },
    {
      label: "72 BPM with 0.25 Hz illumination drift + noise (30 FPS, 20s)",
      targetBpm: 72,
      fps: 30,
      durationSec: 20,
      illuminationDrift: true,
      noiseAmp: 0.15,
    },
    {
      label: "55 BPM resting bradycardia (30 FPS, 20s)",
      targetBpm: 55,
      fps: 30,
      durationSec: 20,
      illuminationDrift: true,
    },
    {
      label: "118 BPM elevated HR (25 FPS variable rate, 18s)",
      targetBpm: 118,
      fps: 25,
      durationSec: 18,
      illuminationDrift: true,
    },
  ];

  let allPassed = true;

  for (const s of scenarios) {
    const resetTelemetry = dispatchToWorker({ type: "reset" });
    if (resetTelemetry.status !== "idle" || resetTelemetry.bpm !== null) {
      console.error(`FAIL [${s.label}]: reset did not return idle telemetry`);
      allPassed = false;
      continue;
    }

    const totalFrames = Math.round(s.fps * s.durationSec);
    const startWall = performance.now();
    let firstTelemetry: VitalTelemetry | null = null;
    let finalTelemetry: VitalTelemetry | null = null;

    for (let i = 0; i < totalFrames; i++) {
      const tSec = i / s.fps;
      const sample = generateSyntheticSample(tSec, s.targetBpm, {
        illuminationDrift: s.illuminationDrift,
        noiseAmp: s.noiseAmp,
      });
      const out = dispatchToWorker({ type: "sample", payload: sample });
      if (i === 0) firstTelemetry = out;
      finalTelemetry = out;
    }

    const elapsedMs = performance.now() - startWall;
    const avgFrameMs = elapsedMs / totalFrames;

    if (!firstTelemetry || firstTelemetry.status !== "calibrating") {
      console.error(`FAIL [${s.label}]: expected initial status "calibrating", got ${firstTelemetry?.status}`);
      allPassed = false;
      continue;
    }

    if (!finalTelemetry || finalTelemetry.status !== "locked" || finalTelemetry.bpm === null) {
      console.error(`FAIL [${s.label}]: did not lock (status=${finalTelemetry?.status}, bpm=${finalTelemetry?.bpm})`);
      allPassed = false;
      continue;
    }

    const errorBpm = Math.abs(finalTelemetry.bpm - s.targetBpm);
    const passed = errorBpm <= 1.0;

    console.log(
      `${passed ? "PASS" : "FAIL"} | ${s.label} -> measured=${finalTelemetry.bpm.toFixed(1)} BPM ` +
        `(err=${errorBpm.toFixed(2)} BPM, SQI=${finalTelemetry.sqiScore}%, ` +
        `wave=${finalTelemetry.ppgWaveValue.toFixed(3)}, ${avgFrameMs.toFixed(2)} ms/frame)`
    );

    if (!passed) {
      allPassed = false;
    }
  }

  if (!allPassed) {
    process.exit(1);
  }
  console.log("\nAll Phase 1 synthetic rPPG worker verification tests passed within ±1.0 BPM.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
