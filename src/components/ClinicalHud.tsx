"use client";

import { useCallback, useState } from "react";
import { Activity, Eye, EyeOff, Play, Square } from "lucide-react";
import { useWebcam } from "@/hooks/useWebcam";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import {
  useMockTelemetry,
  type MockOverrideMode,
} from "@/hooks/useMockTelemetry";
import { PpgWaveformCanvas } from "@/components/PpgWaveformCanvas";
import { ViewfinderPanel } from "@/components/ViewfinderPanel";
import { VitalMetricCard } from "@/components/VitalMetricCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FrozenVitals {
  bpm: number | null;
  hrvRmssdMs: number | null;
  respiratoryRate: number | null;
}

/**
 * Primary PulseCam Biometric Scanner HUD.
 * Strictly locked to `100dvh` with zero vertical page scrolling:
 * - Mobile (< lg): Top 55% live viewfinder + bottom 45% pinned telemetry sheet.
 * - Desktop (lg+): Left 60% viewfinder + 60 FPS PPG waveform; Right 40% vitals cockpit.
 */
export function ClinicalHud() {
  const webcam = useWebcam(false);
  const [showRoiOverlay, setShowRoiOverlay] = useState(true);
  const [frozenVitals, setFrozenVitals] = useState<FrozenVitals>({
    bpm: null,
    hrvRmssdMs: null,
    respiratoryRate: null,
  });

  const faceMesh = useFaceMesh({
    videoRef: webcam.videoRef,
    enabled: webcam.isActive,
  });

  const {
    telemetry,
    ppgWaveRef,
    isScanning,
    remainingSeconds,
    scanProgress,
    overrideMode,
    setOverrideMode,
    startScan,
    stopScan,
  } = useMockTelemetry();

  // Preserve last valid locked readings so warning states display frozen metrics
  const [prevTelemetry, setPrevTelemetry] = useState(telemetry);
  if (telemetry !== prevTelemetry) {
    setPrevTelemetry(telemetry);
    if (telemetry.status === "locked" && telemetry.bpm !== null) {
      setFrozenVitals({
        bpm: telemetry.bpm,
        hrvRmssdMs: telemetry.hrvRmssdMs,
        respiratoryRate: telemetry.respiratoryRate,
      });
    } else if (telemetry.status === "idle") {
      setFrozenVitals({
        bpm: null,
        hrvRmssdMs: null,
        respiratoryRate: null,
      });
    }
  }

  const handleToggleScan = useCallback(() => {
    if (isScanning) {
      stopScan();
      return;
    }
    if (!webcam.isActive) {
      void webcam.startWebcam();
    }
    startScan();
  }, [isScanning, startScan, stopScan, webcam]);

  const sqiVariant =
    telemetry.sqiScore >= 70
      ? "good"
      : telemetry.sqiScore >= 30 || telemetry.status === "calibrating"
        ? "warn"
        : telemetry.status === "motion_detected" || telemetry.status === "low_light"
          ? "warn"
          : "muted";

  const statusLabel =
    telemetry.status === "locked"
      ? "LOCKED"
      : telemetry.status === "calibrating"
        ? "CALIBRATING"
        : telemetry.status === "motion_detected"
          ? "MOTION"
          : telemetry.status === "low_light"
            ? "LOW LIGHT"
            : "IDLE";

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground lg:grid lg:grid-cols-12">
      {/* LEFT / TOP: Live Webcam Viewfinder (+ 60 FPS PPG Waveform on Desktop) */}
      <section className="flex h-[55%] w-full flex-col border-b border-border lg:col-span-7 lg:h-full lg:border-r lg:border-b-0">
        <ViewfinderPanel
          videoRef={webcam.videoRef}
          webcamStatus={webcam.status}
          webcamError={webcam.errorMessage}
          onEnableCamera={() => void webcam.startWebcam()}
          faceMeshStatus={faceMesh.modelStatus}
          faceDetected={faceMesh.faceDetected}
          roiBoxes={faceMesh.roiBoxes}
          showRoiOverlay={showRoiOverlay}
          status={telemetry.status}
          guidanceMessage={telemetry.guidanceMessage}
          className="min-h-0 flex-1"
        />

        {/* Desktop 60 FPS PPG Waveform Dock */}
        <div className="hidden border-t border-border bg-card p-3 lg:block">
          <PpgWaveformCanvas
            waveValueRef={ppgWaveRef}
            status={telemetry.status}
            className="h-32"
          />
        </div>
      </section>

      {/* RIGHT / BOTTOM: Pinned Telemetry Sheet (Mobile 45%) / Cockpit (Desktop 40%) */}
      <aside className="flex h-[45%] w-full flex-col justify-between bg-card px-4 py-3 lg:col-span-5 lg:h-full lg:p-6">
        {/* Header Row: Instrument title + SQI Pill + ROI toggle */}
        <header className="flex items-center justify-between gap-2 border-b border-border pb-2.5 lg:pb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-pulse-accent" />
            <h1 className="text-xs font-semibold tracking-wider uppercase text-foreground lg:text-sm">
              PulseCam
            </h1>
            <Badge variant="muted" className="hidden font-mono text-[10px] sm:inline-flex">
              MOCK TELEMETRY
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={sqiVariant} className="font-mono text-xs tabular-nums">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  sqiVariant === "good"
                    ? "bg-signal-good"
                    : sqiVariant === "warn"
                      ? "bg-signal-warn"
                      : "bg-muted-foreground"
                )}
              />
              SQI {telemetry.sqiScore}%
            </Badge>

            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => setShowRoiOverlay((v) => !v)}
              aria-label={showRoiOverlay ? "Hide ROI overlay" : "Show ROI overlay"}
              title={showRoiOverlay ? "Hide ROI overlay" : "Show ROI overlay"}
              className="border-border bg-background text-muted-foreground hover:text-foreground"
            >
              {showRoiOverlay ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </header>

        {/* Mobile Compact 60 FPS PPG Trace */}
        <div className="my-2 lg:hidden">
          <PpgWaveformCanvas
            waveValueRef={ppgWaveRef}
            status={telemetry.status}
            compact
            className="h-11"
          />
        </div>

        {/* Vitals Grid */}
        <div className="grid grid-cols-3 gap-2 lg:my-auto lg:grid-cols-2 lg:gap-3">
          <VitalMetricCard
            label="Heart Rate"
            unit="BPM"
            value={telemetry.bpm}
            frozenValue={frozenVitals.bpm}
            status={telemetry.status}
            accent="pulse"
            prominent
            className="lg:col-span-2"
          />
          <VitalMetricCard
            label="HRV (RMSSD)"
            unit="ms"
            value={telemetry.hrvRmssdMs}
            frozenValue={frozenVitals.hrvRmssdMs}
            status={telemetry.status}
          />
          <VitalMetricCard
            label="Resp. Rate"
            unit="br/min"
            value={telemetry.respiratoryRate}
            frozenValue={frozenVitals.respiratoryRate}
            status={telemetry.status}
            decimals={1}
          />

          {/* Desktop Calibration & Diagnostic Telemetry Row */}
          <div className="hidden rounded-lg border border-border bg-background p-3 lg:col-span-2 lg:flex lg:flex-col lg:gap-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Signal State</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {statusLabel}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Scan Window</span>
              <span className="font-mono tabular-nums text-foreground">
                {isScanning ? `${remainingSeconds}s remaining` : "30s ready"}
              </span>
            </div>

            {/* Phase 1 Mock State Preview Toggle (active during scan) */}
            {isScanning && (
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
                  State Preview
                </span>
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["auto", "Live"],
                      ["motion_detected", "Motion"],
                      ["low_light", "Low Light"],
                    ] as [MockOverrideMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOverrideMode(mode)}
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                        overrideMode === mode
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA: Progress Bar + Primary Scan Button */}
        <footer className="mt-2 space-y-2 lg:mt-4">
          <div className="h-1 w-full overflow-hidden rounded-full bg-background">
            <div
              className={cn(
                "h-full transition-all duration-200",
                telemetry.status === "motion_detected" ||
                  telemetry.status === "low_light"
                  ? "bg-signal-warn"
                  : "bg-signal-good"
              )}
              style={{ width: `${scanProgress}%` }}
            />
          </div>

          <Button
            type="button"
            size="lg"
            onClick={handleToggleScan}
            className={cn(
              "h-10 w-full font-medium lg:h-11",
              isScanning
                ? "border border-border bg-background text-foreground hover:bg-border/40"
                : "bg-foreground text-background hover:bg-foreground/90"
            )}
          >
            {isScanning ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop Scan</span>
                <span className="ml-auto font-mono text-xs tabular-nums">
                  {remainingSeconds}s
                </span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Start 30s Scan</span>
              </>
            )}
          </Button>
        </footer>
      </aside>
    </main>
  );
}
