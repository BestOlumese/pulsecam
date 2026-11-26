"use client";

import { useEffect, useRef } from "react";
import type { SignalStatus } from "@/types/telemetry";
import { cn } from "@/lib/utils";

export interface PpgWaveformCanvasProps {
  /** Continuously updated [-1, 1] normalized PPG value ref. */
  waveValueRef: React.RefObject<number>;
  status: SignalStatus;
  className?: string;
  compact?: boolean;
}

const TRACE_SAMPLES = 240; // ~4 seconds visible at 60 FPS
const COLOR_BG = "#09090B";
const COLOR_GRID = "#27272A";
const COLOR_PULSE = "#F43F5E";
const COLOR_WARN = "#F59E0B";
const COLOR_IDLE = "#A1A1AA";

/**
 * 60 FPS HTML5 <canvas> PPG oscilloscope waveform.
 * Runs exclusively inside requestAnimationFrame using a fixed Float32Array trace buffer
 * with zero per-frame allocations and zero React state updates.
 */
export function PpgWaveformCanvas({
  waveValueRef,
  status,
  className,
  compact = false,
}: PpgWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<SignalStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const trace = new Float32Array(TRACE_SAMPLES);
    let writeIdx = 0;
    let smoothed = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let rafId = 0;

    const render = () => {
      const currentStatus = statusRef.current;
      const targetVal =
        currentStatus === "idle" ? 0 : (waveValueRef.current ?? 0);

      // Light temporal interpolation for crisp 60 FPS trace continuity
      smoothed += (targetVal - smoothed) * 0.35;
      trace[writeIdx] = smoothed;
      writeIdx = (writeIdx + 1) % TRACE_SAMPLES;

      // Clear background
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, width, height);

      // Subtle clinical grid hairlines
      ctx.strokeStyle = COLOR_GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();

      const midY = Math.round(height * 0.5) + 0.5;
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);

      if (!compact) {
        const q1Y = Math.round(height * 0.25) + 0.5;
        const q3Y = Math.round(height * 0.75) + 0.5;
        ctx.moveTo(0, q1Y);
        ctx.lineTo(width, q1Y);
        ctx.moveTo(0, q3Y);
        ctx.lineTo(width, q3Y);

        const cols = 8;
        for (let c = 1; c < cols; c++) {
          const x = Math.round((width / cols) * c) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
      }
      ctx.stroke();

      // Determine trace stroke color strictly from clinical tokens
      const isWarning =
        currentStatus === "motion_detected" || currentStatus === "low_light";
      const strokeColor =
        currentStatus === "idle"
          ? COLOR_IDLE
          : isWarning
            ? COLOR_WARN
            : COLOR_PULSE;

      const padY = compact ? 6 : 14;
      const amplitude = Math.max(4, height * 0.5 - padY);
      const stepX = width / (TRACE_SAMPLES - 1);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = compact ? 1.5 : 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();

      let lastX = 0;
      let lastY = height * 0.5;

      for (let i = 0; i < TRACE_SAMPLES; i++) {
        const sampleIdx = (writeIdx + i) % TRACE_SAMPLES;
        const v = trace[sampleIdx];
        const x = i * stepX;
        const y = height * 0.5 - v * amplitude;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        lastX = x;
        lastY = y;
      }
      ctx.stroke();

      // Leading sample marker (no neon shadow/glow)
      if (currentStatus !== "idle") {
        ctx.fillStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(Math.min(width - 3, lastX), lastY, compact ? 2 : 3, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [compact, waveValueRef]);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border bg-background",
        className
      )}
    >
      <canvas
        ref={canvasRef}
        aria-label="Live PPG pulse waveform"
        className="block h-full w-full"
      />
      <div className="pointer-events-none absolute top-2 left-2.5 flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
          PPG TRACE
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          60 FPS
        </span>
      </div>
    </div>
  );
}
