"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ShieldCheck, AlertTriangle, Activity } from "lucide-react";
import type { RoiRgbSample, SignalStatus } from "@/types/telemetry";
import type {
  FaceAlignmentState,
  FaceMeshStatus,
  FaceRoiBoxes,
  NormalizedBox,
} from "@/hooks/useFaceMesh";
import type { WebcamStatus } from "@/hooks/useWebcam";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CoverTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

const IDENTITY_TRANSFORM: CoverTransform = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

function mapBoxToCover(box: NormalizedBox, t: CoverTransform): NormalizedBox {
  return {
    x: t.offsetX + box.x * t.scaleX,
    y: t.offsetY + box.y * t.scaleY,
    width: box.width * t.scaleX,
    height: box.height * t.scaleY,
  };
}

function formatRgb(rgb: [number, number, number]): string {
  return `${Math.round(rgb[0]).toString().padStart(3, " ")} ${Math.round(rgb[1])
    .toString()
    .padStart(3, " ")} ${Math.round(rgb[2]).toString().padStart(3, " ")}`;
}

export interface ViewfinderPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  webcamStatus: WebcamStatus;
  webcamError: string | null;
  onEnableCamera: () => void;
  faceMeshStatus: FaceMeshStatus;
  faceDetected: boolean;
  faceAlignment: FaceAlignmentState;
  roiBoxes: FaceRoiBoxes | null;
  debugSample: RoiRgbSample | null;
  sampleRateHz: number;
  showRoiOverlay: boolean;
  status: SignalStatus;
  guidanceMessage: string;
  className?: string;
}

/**
 * Live local webcam viewfinder with clinical face-alignment reticle,
 * mirrored ROI boxes (forehead + cheeks), toggleable ROI debug telemetry HUD,
 * privacy pill, and guidance prompt.
 */
export function ViewfinderPanel({
  videoRef,
  webcamStatus,
  webcamError,
  onEnableCamera,
  faceMeshStatus,
  faceDetected,
  faceAlignment,
  roiBoxes,
  debugSample,
  sampleRateHz,
  showRoiOverlay,
  status,
  guidanceMessage,
  className,
}: ViewfinderPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coverTransform, setCoverTransform] =
    useState<CoverTransform>(IDENTITY_TRANSFORM);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const recompute = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!cw || !ch || !vw || !vh) return;

      const cRatio = cw / ch;
      const vRatio = vw / vh;

      if (cRatio > vRatio) {
        const scaleY = cRatio / vRatio;
        setCoverTransform({
          scaleX: 1,
          scaleY,
          offsetX: 0,
          offsetY: (1 - scaleY) * 0.5,
        });
      } else {
        const scaleX = vRatio / cRatio;
        setCoverTransform({
          scaleX,
          scaleY: 1,
          offsetX: (1 - scaleX) * 0.5,
          offsetY: 0,
        });
      }
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    video.addEventListener("loadedmetadata", recompute);

    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", recompute);
    };
  }, [videoRef, webcamStatus]);

  const isWarning = status === "motion_detected" || status === "low_light";
  const isLocked = status === "locked";
  const isMisaligned =
    faceAlignment === "move_closer" || faceAlignment === "off_center";

  const reticleStroke =
    isWarning || isMisaligned
      ? "border-signal-warn"
      : isLocked || faceAlignment === "aligned"
        ? "border-signal-good"
        : "border-border";

  const alignmentBadge =
    faceAlignment === "aligned"
      ? { label: "FACE ALIGNED", variant: "good" as const }
      : faceAlignment === "move_closer"
        ? { label: "MOVE CLOSER", variant: "warn" as const }
        : faceAlignment === "off_center"
          ? { label: "CENTER FACE", variant: "warn" as const }
          : faceMeshStatus === "loading"
            ? { label: "LOADING MESH", variant: "warn" as const }
            : webcamStatus === "ready"
              ? { label: "SEEKING FACE", variant: "muted" as const }
              : { label: "SENSOR IDLE", variant: "muted" as const };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden bg-background",
        className
      )}
    >
      {/* Mirrored live local webcam stream */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={cn(
          "h-full w-full scale-x-[-1] object-cover transition-opacity duration-200",
          webcamStatus === "ready" ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Standby / error overlay when camera is inactive */}
      {webcamStatus !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card">
            <Camera className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {webcamStatus === "requesting"
                ? "Initializing Local Camera..."
                : webcamStatus === "error"
                  ? "Camera Access Required"
                  : "Optical Sensor Standby"}
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {webcamError ??
                "All video frames remain 100% on-device inside browser memory."}
            </p>
          </div>
          {webcamStatus !== "requesting" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onEnableCamera}
              className="mt-1 border-border bg-card text-foreground hover:bg-border/40"
            >
              <Camera className="h-3.5 w-3.5" />
              Enable Camera
            </Button>
          )}
        </div>
      )}

      {/* Clinical face-alignment reticle with registration ticks & center guides */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "relative h-[68%] aspect-[3/4] max-h-[300px] rounded-[46%] border border-dashed transition-colors duration-200",
            reticleStroke
          )}
        >
          {/* Corner registration brackets */}
          <span
            className={cn(
              "absolute -top-px -left-px h-3.5 w-3.5 rounded-tl-md border-t-2 border-l-2",
              reticleStroke
            )}
          />
          <span
            className={cn(
              "absolute -top-px -right-px h-3.5 w-3.5 rounded-tr-md border-t-2 border-r-2",
              reticleStroke
            )}
          />
          <span
            className={cn(
              "absolute -bottom-px -left-px h-3.5 w-3.5 rounded-bl-md border-b-2 border-l-2",
              reticleStroke
            )}
          />
          <span
            className={cn(
              "absolute -bottom-px -right-px h-3.5 w-3.5 rounded-br-md border-b-2 border-r-2",
              reticleStroke
            )}
          />
          {/* Subtle top/bottom/side alignment ticks */}
          <span
            className={cn(
              "absolute top-0 left-1/2 h-2 w-px -translate-x-1/2 border-l",
              reticleStroke
            )}
          />
          <span
            className={cn(
              "absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 border-l",
              reticleStroke
            )}
          />
          <span
            className={cn(
              "absolute top-1/2 left-0 h-px w-2 -translate-y-1/2 border-t",
              reticleStroke
            )}
          />
          <span
            className={cn(
              "absolute top-1/2 right-0 h-px w-2 -translate-y-1/2 border-t",
              reticleStroke
            )}
          />
        </div>
      </div>

      {/* Mirrored ROI overlay boxes (forehead + left/right cheeks) */}
      {showRoiOverlay && webcamStatus === "ready" && roiBoxes && (
        <div className="pointer-events-none absolute inset-0 scale-x-[-1]">
          {(
            [
              ["FH", mapBoxToCover(roiBoxes.forehead, coverTransform)],
              ["LC", mapBoxToCover(roiBoxes.leftCheek, coverTransform)],
              ["RC", mapBoxToCover(roiBoxes.rightCheek, coverTransform)],
            ] as const
          ).map(([tag, box]) => (
            <div
              key={tag}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
              className="absolute border border-signal-good bg-signal-good/10"
            >
              <span className="inline-block scale-x-[-1] bg-background/85 px-1 font-mono text-[9px] text-signal-good">
                {tag}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Top HUD status bar */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-center justify-between gap-2">
        <Badge variant="default" className="bg-background/90 font-mono text-[10px]">
          <ShieldCheck className="h-3 w-3 text-signal-good" />
          ON-DEVICE • 0B SENT
        </Badge>

        <Badge
          variant={alignmentBadge.variant}
          className="bg-background/90 font-mono text-[10px]"
        >
          <Activity className="h-3 w-3" />
          {alignmentBadge.label}
        </Badge>
      </div>

      {/* Toggleable ROI Debug Telemetry Panel (live R/G/B + head velocity + FPS) */}
      {showRoiOverlay && webcamStatus === "ready" && (
        <div className="pointer-events-none absolute top-11 left-3 rounded-md border border-border bg-background/90 px-2.5 py-2 font-mono text-[10px] leading-relaxed tabular-nums text-muted-foreground">
          <div className="mb-1 flex items-center justify-between gap-4 border-b border-border pb-1 text-[9px] tracking-wider uppercase text-foreground">
            <span>ROI DEBUG (R G B)</span>
            <span className="text-signal-good">
              {sampleRateHz > 0 ? `${sampleRateHz} Hz` : "-- Hz"}
            </span>
          </div>
          {debugSample && faceDetected ? (
            <div className="space-y-0.5 whitespace-pre">
              <div>
                <span className="text-signal-good">FH </span>
                <span className="text-foreground">
                  {formatRgb(debugSample.forehead)}
                </span>
              </div>
              <div>
                <span className="text-signal-good">LC </span>
                <span className="text-foreground">
                  {formatRgb(debugSample.leftCheek)}
                </span>
              </div>
              <div>
                <span className="text-signal-good">RC </span>
                <span className="text-foreground">
                  {formatRgb(debugSample.rightCheek)}
                </span>
              </div>
              <div className="border-t border-border pt-0.5">
                <span>VEL </span>
                <span className="text-foreground">
                  {debugSample.headVelocity.toFixed(2)}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">Awaiting face landmarks...</div>
          )}
        </div>
      )}

      {/* Bottom contextual HUD guidance prompt */}
      <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex justify-center">
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium",
            isWarning || isMisaligned
              ? "border-signal-warn bg-background/95 text-signal-warn"
              : isLocked
                ? "border-signal-good/50 bg-background/95 text-signal-good"
                : "border-border bg-background/95 text-foreground"
          )}
        >
          {(isWarning || isMisaligned) && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{guidanceMessage}</span>
        </div>
      </div>
    </div>
  );
}
