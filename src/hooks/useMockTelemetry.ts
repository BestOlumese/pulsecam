"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SignalStatus, VitalTelemetry } from "@/types/telemetry";

export type MockOverrideMode = "auto" | "motion_detected" | "low_light";

export interface UseMockTelemetryResult {
  telemetry: VitalTelemetry;
  /** Continuously updated at 60 FPS inside rAF for zero-jank canvas rendering. */
  ppgWaveRef: React.RefObject<number>;
  isScanning: boolean;
  remainingSeconds: number;
  scanProgress: number;
  overrideMode: MockOverrideMode;
  setOverrideMode: (mode: MockOverrideMode) => void;
  startScan: () => void;
  stopScan: () => void;
}

const SCAN_DURATION_SEC = 30;
const CALIBRATION_DURATION_SEC = 4;

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
 * Generates a realistic PPG pulse wave with systolic peak + dicrotic notch
 * normalized cleanly to [-1, 1].
 */
function synthesizePpgWave(tSec: number, bpm: number): number {
  const f = bpm / 60;
  const phase = 2 * Math.PI * f * tSec;
  const systolic = 0.68 * Math.sin(phase);
  const dicrotic = 0.24 * Math.sin(2 * phase - 1.15);
  const harmonic = 0.08 * Math.sin(3 * phase - 2.1);
  return Math.max(-1, Math.min(1, systolic + dicrotic + harmonic));
}

/**
 * Temporary Phase 1 mock telemetry hook.
 * Produces realistic VitalTelemetry transitions (`idle` -> `calibrating` -> `locked`,
 * plus optional `motion_detected` / `low_light` previews) and a 60 FPS PPG waveform ref.
 * Replaced by the real Web Worker stream in Phase 2.
 */
export function useMockTelemetry(): UseMockTelemetryResult {
  const [isScanning, setIsScanning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(SCAN_DURATION_SEC);
  const [scanProgress, setScanProgress] = useState(0);
  const [overrideMode, setOverrideMode] = useState<MockOverrideMode>("auto");
  const [telemetry, setTelemetry] = useState<VitalTelemetry>(IDLE_TELEMETRY);

  const ppgWaveRef = useRef<number>(0);
  const scanStartMsRef = useRef<number>(0);
  const lastUiUpdateMsRef = useRef<number>(0);
  const overrideModeRef = useRef<MockOverrideMode>("auto");

  useEffect(() => {
    overrideModeRef.current = overrideMode;
  }, [overrideMode]);

  const startScan = useCallback(() => {
    scanStartMsRef.current = performance.now();
    lastUiUpdateMsRef.current = 0;
    setOverrideMode("auto");
    setRemainingSeconds(SCAN_DURATION_SEC);
    setScanProgress(0);
    setIsScanning(true);
  }, []);

  const stopScan = useCallback(() => {
    setIsScanning(false);
    setRemainingSeconds(SCAN_DURATION_SEC);
    setScanProgress(0);
    setOverrideMode("auto");
    ppgWaveRef.current = 0;
    setTelemetry(IDLE_TELEMETRY);
  }, []);

  useEffect(() => {
    if (!isScanning) {
      ppgWaveRef.current = 0;
      return;
    }

    let rafId = 0;

    const tick = (nowMs: number) => {
      const elapsedSec = Math.max(0, (nowMs - scanStartMsRef.current) / 1000);
      const mode = overrideModeRef.current;

      // Gentle respiratory sinus arrhythmia around 72 BPM
      const liveBpm = 72 + 1.6 * Math.sin(2 * Math.PI * 0.16 * elapsedSec);
      const rawWave = synthesizePpgWave(elapsedSec, liveBpm);

      if (mode === "motion_detected") {
        // Motion artifact burst on waveform
        ppgWaveRef.current = Math.max(
          -1,
          Math.min(1, 0.85 * Math.sin(2 * Math.PI * 5.2 * elapsedSec))
        );
      } else if (mode === "low_light") {
        ppgWaveRef.current = 0.06 * Math.sin(2 * Math.PI * 2.1 * elapsedSec);
      } else if (elapsedSec < CALIBRATION_DURATION_SEC) {
        const ramp = Math.min(1, elapsedSec / CALIBRATION_DURATION_SEC);
        ppgWaveRef.current = rawWave * ramp * 0.7;
      } else {
        ppgWaveRef.current = rawWave;
      }

      // Update React telemetry cards at ~5 Hz to avoid unnecessary DOM churn
      if (nowMs - lastUiUpdateMsRef.current >= 200) {
        lastUiUpdateMsRef.current = nowMs;

        const clampedElapsed = Math.min(SCAN_DURATION_SEC, elapsedSec);
        const remaining = Math.max(0, Math.ceil(SCAN_DURATION_SEC - clampedElapsed));
        setRemainingSeconds(remaining);
        setScanProgress(Math.min(100, (clampedElapsed / SCAN_DURATION_SEC) * 100));

        let status: SignalStatus;
        let bpm: number | null = null;
        let hrvRmssdMs: number | null = null;
        let respiratoryRate: number | null = null;
        let sqiScore = 0;
        let guidanceMessage = "Calibrating signal...";

        if (mode === "motion_detected") {
          status = "motion_detected";
          sqiScore = 18;
          guidanceMessage = "Hold still — motion detected";
        } else if (mode === "low_light") {
          status = "low_light";
          sqiScore = 14;
          guidanceMessage = "Move toward brighter, even lighting";
        } else if (elapsedSec < CALIBRATION_DURATION_SEC) {
          status = "calibrating";
          sqiScore = Math.round((elapsedSec / CALIBRATION_DURATION_SEC) * 65);
          guidanceMessage = `Calibrating optical signal (${Math.ceil(
            CALIBRATION_DURATION_SEC - elapsedSec
          )}s)...`;
        } else {
          status = "locked";
          bpm = Math.round(liveBpm * 10) / 10;
          hrvRmssdMs = Math.round(
            48 + 3.2 * Math.sin(2 * Math.PI * 0.08 * elapsedSec)
          );
          respiratoryRate =
            Math.round((15.2 + 0.6 * Math.sin(2 * Math.PI * 0.05 * elapsedSec)) * 10) /
            10;
          sqiScore = Math.round(91 + 4 * Math.sin(2 * Math.PI * 0.12 * elapsedSec));
          guidanceMessage =
            clampedElapsed >= SCAN_DURATION_SEC
              ? "30s scan complete — signal locked"
              : "Signal locked — hold steady";
        }

        setTelemetry({
          status,
          bpm,
          hrvRmssdMs,
          respiratoryRate,
          sqiScore,
          skinToneCalibrationActive: false,
          ppgWaveValue: ppgWaveRef.current,
          guidanceMessage,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isScanning]);

  return {
    telemetry,
    ppgWaveRef,
    isScanning,
    remainingSeconds,
    scanProgress,
    overrideMode,
    setOverrideMode,
    startScan,
    stopScan,
  };
}
