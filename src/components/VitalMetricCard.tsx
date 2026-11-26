"use client";

import type { SignalStatus } from "@/types/telemetry";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface VitalMetricCardProps {
  label: string;
  unit: string;
  value: number | null;
  frozenValue: number | null;
  status: SignalStatus;
  accent?: "pulse" | "default";
  decimals?: number;
  prominent?: boolean;
  className?: string;
}

/**
 * Clinical metric card adhering strictly to docs/DESIGN_SYSTEM.md.
 * Handles `idle`, `calibrating`, `low_signal` (frozen last valid reading), and `locked`.
 */
export function VitalMetricCard({
  label,
  unit,
  value,
  frozenValue,
  status,
  accent = "default",
  decimals = 0,
  prominent = false,
  className,
}: VitalMetricCardProps) {
  const isWarning = status === "motion_detected" || status === "low_light";
  const isLocked = status === "locked" && value !== null;
  const isCalibrating = status === "calibrating";

  const displayNum = isLocked ? value : isWarning ? frozenValue : null;
  const formatted =
    displayNum !== null
      ? decimals > 0
        ? displayNum.toFixed(decimals)
        : Math.round(displayNum).toString()
      : "--";

  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-lg border bg-card transition-colors",
        prominent ? "p-3.5 lg:p-4" : "p-3",
        isWarning ? "border-signal-warn/60" : "border-border",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
          {label}
        </span>

        {isWarning ? (
          <Badge variant="warn" className="px-1.5 py-0 text-[10px]">
            FROZEN
          </Badge>
        ) : isCalibrating ? (
          <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
            CAL
          </span>
        ) : isLocked ? (
          <span className="h-1.5 w-1.5 rounded-full bg-signal-good" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-border" />
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-mono font-semibold tracking-tight tabular-nums leading-none",
            prominent ? "text-3xl lg:text-5xl" : "text-2xl lg:text-3xl",
            isWarning
              ? "text-signal-warn"
              : isLocked && accent === "pulse"
                ? "text-pulse-accent"
                : isLocked
                  ? "text-foreground"
                  : "text-muted-foreground"
          )}
        >
          {formatted}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
