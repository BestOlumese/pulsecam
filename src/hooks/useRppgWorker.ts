"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoiRgbSample, VitalTelemetry } from "@/types/telemetry";
import type { RppgWorkerInboundMessage } from "@/workers/rppg.worker";

export interface UseRppgWorkerResult {
  telemetry: VitalTelemetry;
  /** Continuously updated on every worker frame for zero-jank 60 FPS canvas rendering. */
  ppgWaveRef: React.RefObject<number>;
  isScanning: boolean;
  scanCompleted: boolean;
  remainingSeconds: number;
  scanProgress: number;
  sampleRateHz: number;
  workerError: string | null;
  pushSample: (sample: RoiRgbSample) => void;
  startScan: () => void;
  stopScan: () => void;
}

const SCAN_DURATION_SEC = 30;

const IDLE_TELEMETRY: VitalTelemetry = {
  status: "idle",
  bpm: null,
  hrvRmssdMs: null,
  respiratoryRate: null,
  sqiScore: 0,
  skinToneCalibrationActive: false,
  ppgWaveValue: 0,
  guidanceMessage: "Align face within reticle to begin 30s scan",
};

/**
 * Live Web Worker bridge for Phase 2 rPPG integration.
 * Streams `RoiRgbSample` frames from `useFaceMesh` to `src/workers/rppg.worker.ts`
 * via `postMessage`, keeping all POS / bandpass / 1024-pt FFT math off the main thread.
 */
export function useRppgWorker(): UseRppgWorkerResult {
  const [telemetry, setTelemetry] = useState<VitalTelemetry>(IDLE_TELEMETRY);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(SCAN_DURATION_SEC);
  const [scanProgress, setScanProgress] = useState(0);
  const [sampleRateHz, setSampleRateHz] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const ppgWaveRef = useRef<number>(0);
  const isScanningRef = useRef(false);
  const lastUiSyncMsRef = useRef(0);
  const lastStatusRef = useRef(IDLE_TELEMETRY.status);
  const fpsWindowStartRef = useRef(0);
  const fpsFrameCountRef = useRef(0);

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  // Spawn dedicated rPPG Web Worker once per mount
  useEffect(() => {
    if (typeof Worker === "undefined") {
      return;
    }

    const worker = new Worker(
      new URL("../workers/rppg.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<VitalTelemetry>) => {
      if (!isScanningRef.current) {
        return;
      }
      const next = event.data;
      ppgWaveRef.current = next.ppgWaveValue;

      // Always commit status transitions immediately; throttle steady-state card updates to ~5 Hz
      const now = performance.now();
      const statusChanged = next.status !== lastStatusRef.current;
      if (statusChanged || now - lastUiSyncMsRef.current >= 180) {
        lastUiSyncMsRef.current = now;
        lastStatusRef.current = next.status;
        setTelemetry(next);
      }
    };

    worker.onerror = (err) => {
      setWorkerError(err.message || "rPPG Web Worker encountered an error.");
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // 30-second scan progress timer — automatically completes and stops at 30s
  useEffect(() => {
    if (!isScanning) {
      return;
    }

    const startedAt = performance.now();
    const intervalId = window.setInterval(() => {
      const elapsedSec = (performance.now() - startedAt) / 1000;
      if (elapsedSec >= SCAN_DURATION_SEC) {
        window.clearInterval(intervalId);
        isScanningRef.current = false;
        ppgWaveRef.current = 0;
        setRemainingSeconds(0);
        setScanProgress(100);
        setIsScanning(false);
        setScanCompleted(true);
        setTelemetry((prev) => ({
          ...prev,
          ppgWaveValue: 0,
          guidanceMessage:
            prev.bpm !== null
              ? "30s scan complete — final reading captured"
              : "30s scan complete — improve lighting and rescan",
        }));
        return;
      }

      const remaining = Math.max(1, Math.ceil(SCAN_DURATION_SEC - elapsedSec));
      setRemainingSeconds(remaining);
      setScanProgress(Math.min(100, (elapsedSec / SCAN_DURATION_SEC) * 100));
    }, 200);

    return () => window.clearInterval(intervalId);
  }, [isScanning]);

  const postToWorker = useCallback((message: RppgWorkerInboundMessage) => {
    workerRef.current?.postMessage(message);
  }, []);

  const pushSample = useCallback(
    (sample: RoiRgbSample) => {
      // Measure effective FaceMesh -> Worker throughput for ROI debug HUD
      const now = performance.now();
      if (fpsWindowStartRef.current === 0) {
        fpsWindowStartRef.current = now;
      }
      fpsFrameCountRef.current += 1;
      const elapsed = now - fpsWindowStartRef.current;
      if (elapsed >= 1000) {
        setSampleRateHz(Math.round((fpsFrameCountRef.current * 1000) / elapsed));
        fpsWindowStartRef.current = now;
        fpsFrameCountRef.current = 0;
      }

      if (!isScanningRef.current) {
        return;
      }

      postToWorker({ type: "sample", payload: sample });
    },
    [postToWorker]
  );

  const startScan = useCallback(() => {
    setWorkerError(null);
    setScanCompleted(false);
    setRemainingSeconds(SCAN_DURATION_SEC);
    setScanProgress(0);
    ppgWaveRef.current = 0;
    lastUiSyncMsRef.current = 0;
    lastStatusRef.current = "calibrating";
    setTelemetry({
      ...IDLE_TELEMETRY,
      status: "calibrating",
      guidanceMessage: "Position face in reticle — calibrating...",
    });
    postToWorker({ type: "reset" });
    isScanningRef.current = true;
    setIsScanning(true);
  }, [postToWorker]);

  const stopScan = useCallback(() => {
    isScanningRef.current = false;
    setIsScanning(false);
    setScanCompleted(false);
    setRemainingSeconds(SCAN_DURATION_SEC);
    setScanProgress(0);
    setSampleRateHz(0);
    fpsWindowStartRef.current = 0;
    fpsFrameCountRef.current = 0;
    ppgWaveRef.current = 0;
    lastStatusRef.current = "idle";
    postToWorker({ type: "reset" });
    setTelemetry(IDLE_TELEMETRY);
  }, [postToWorker]);

  return {
    telemetry,
    ppgWaveRef,
    isScanning,
    scanCompleted,
    remainingSeconds,
    scanProgress,
    sampleRateHz,
    workerError,
    pushSample,
    startScan,
    stopScan,
  };
}
