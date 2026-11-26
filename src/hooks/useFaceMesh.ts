"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RoiRgbSample } from "@/types/telemetry";

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceRoiBoxes {
  forehead: NormalizedBox;
  leftCheek: NormalizedBox;
  rightCheek: NormalizedBox;
  faceBounds: NormalizedBox;
}

export type FaceMeshStatus = "idle" | "loading" | "ready" | "error";

export interface UseFaceMeshOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  onSample?: (sample: RoiRgbSample) => void;
}

export interface UseFaceMeshResult {
  modelStatus: FaceMeshStatus;
  modelError: string | null;
  faceDetected: boolean;
  roiBoxes: FaceRoiBoxes | null;
  latestSampleRef: React.RefObject<RoiRgbSample | null>;
}

const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Anatomical MediaPipe 468-point facial landmark indices for rPPG skin ROIs
// (Subject-relative: LEFT = subject's left cheek, RIGHT = subject's right cheek)
const FOREHEAD_LANDMARKS = [10, 67, 109, 151, 297, 338, 9, 107, 336];
const LEFT_CHEEK_LANDMARKS = [280, 330, 347, 348, 352, 411, 425, 427];
const RIGHT_CHEEK_LANDMARKS = [50, 101, 118, 119, 123, 187, 205, 207];

// Stable anchor landmarks for scale-invariant head motion tracking
const NOSE_TIP_IDX = 1;
const LEFT_EYE_INNER_IDX = 133;
const RIGHT_EYE_INNER_IDX = 362;

const SAMPLE_CANVAS_WIDTH = 320;
const SAMPLE_CANVAS_HEIGHT = 240;

/**
 * MediaPipe's Emscripten WASM runtime captures `var err = console.error.bind(console)`
 * during `vision_wasm_internal.js` initialization, then later writes benign
 * `INFO: Created TensorFlow Lite XNNPACK delegate for CPU.` lines through that captured
 * `err` reference—causing Next.js dev error overlays to fire on an INFO log.
 *
 * Wrapping `console.error` ONLY during WASM module initialization lets Emscripten bind
 * to this filter while immediately restoring the global `console.error` afterward.
 * All genuine errors still pass directly to the original `console.error`.
 */
async function withMediaPipeInitFilter<T>(fn: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  const filteredError = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first.includes("INFO: Created TensorFlow Lite")) {
      console.info(...args);
      return;
    }
    originalError.apply(console, args);
  };
  console.error = filteredError;
  try {
    return await fn();
  } finally {
    if (console.error === filteredError) {
      console.error = originalError;
    }
  }
}

function computeLandmarkBox(
  landmarks: NormalizedLandmark[],
  indices: number[],
  insetRatio = 0.08
): NormalizedBox {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (let i = 0; i < indices.length; i++) {
    const pt = landmarks[indices[i]];
    if (!pt) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const rawW = Math.max(0.01, maxX - minX);
  const rawH = Math.max(0.01, maxY - minY);
  const padX = rawW * insetRatio;
  const padY = rawH * insetRatio;

  const x = Math.max(0, Math.min(1, minX + padX));
  const y = Math.max(0, Math.min(1, minY + padY));
  const width = Math.max(0.01, Math.min(1 - x, rawW - padX * 2));
  const height = Math.max(0.01, Math.min(1 - y, rawH - padY * 2));

  return { x, y, width, height };
}

function computeFaceBounds(landmarks: NormalizedLandmark[]): NormalizedBox {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < landmarks.length; i += 4) {
    const pt = landmarks[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    width: Math.max(0.01, Math.min(1, maxX - minX)),
    height: Math.max(0.01, Math.min(1, maxY - minY)),
  };
}

function extractMeanRgbFromBox(
  ctx: CanvasRenderingContext2D,
  box: NormalizedBox,
  canvasW: number,
  canvasH: number
): [number, number, number] {
  const px = Math.max(0, Math.floor(box.x * canvasW));
  const py = Math.max(0, Math.floor(box.y * canvasH));
  const pw = Math.max(1, Math.min(canvasW - px, Math.floor(box.width * canvasW)));
  const ph = Math.max(1, Math.min(canvasH - py, Math.floor(box.height * canvasH)));

  const imgData = ctx.getImageData(px, py, pw, ph).data;
  const pixelCount = pw * ph;
  if (pixelCount === 0) {
    return [0, 0, 0];
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = 0; i < imgData.length; i += 4) {
    rSum += imgData[i];
    gSum += imgData[i + 1];
    bSum += imgData[i + 2];
  }

  return [rSum / pixelCount, gSum / pixelCount, bSum / pixelCount];
}

/**
 * Client-side MediaPipe FaceLandmarker hook that extracts per-frame forehead,
 * left cheek, and right cheek RGB means plus scale-invariant head velocity
 * strictly conforming to `RoiRgbSample`.
 */
export function useFaceMesh({
  videoRef,
  enabled,
  onSample,
}: UseFaceMeshOptions): UseFaceMeshResult {
  const [modelStatus, setModelStatus] = useState<FaceMeshStatus>("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [roiBoxes, setRoiBoxes] = useState<FaceRoiBoxes | null>(null);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const latestSampleRef = useRef<RoiRgbSample | null>(null);
  const onSampleRef = useRef(onSample);

  useEffect(() => {
    onSampleRef.current = onSample;
  }, [onSample]);

  const prevAnchorRef = useRef<{ x: number; y: number; ts: number } | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const lastDetectTsRef = useRef<number>(0);
  const lastUiSyncRef = useRef<number>(0);

  // Lazy-initialize MediaPipe FaceLandmarker when enabled
  useEffect(() => {
    if (!enabled) return;
    if (landmarkerRef.current) {
      setModelStatus("ready");
      return;
    }

    let cancelled = false;
    setModelStatus("loading");
    setModelError(null);

    async function initLandmarker() {
      try {
        const landmarker = await withMediaPipeInitFilter(async () => {
          const vision = await import("@mediapipe/tasks-vision");
          const fileset = await vision.FilesetResolver.forVisionTasks(
            MEDIAPIPE_WASM_URL
          );

          try {
            return await vision.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: {
                modelAssetPath: FACE_LANDMARKER_MODEL_URL,
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numFaces: 1,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
          } catch {
            // Graceful CPU fallback when WebGL2 GPU delegate is unavailable
            return await vision.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: {
                modelAssetPath: FACE_LANDMARKER_MODEL_URL,
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numFaces: 1,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
          }
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setModelStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setModelStatus("error");
        setModelError(
          err instanceof Error
            ? err.message
            : "Failed to initialize FaceLandmarker model."
        );
      }
    }

    void initLandmarker();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Dispose landmarker on unmount
  useEffect(() => {
    return () => {
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, []);

  const isTrackingActive = enabled && modelStatus === "ready";

  // Per-frame ROI extraction loop
  useEffect(() => {
    if (!isTrackingActive) {
      prevAnchorRef.current = null;
      lastVideoTimeRef.current = -1;
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_CANVAS_WIDTH;
    canvas.height = SAMPLE_CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let rafId = 0;

    const processFrame = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (
        video &&
        landmarker &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTimeRef.current
      ) {
        lastVideoTimeRef.current = video.currentTime;
        const nowMs = performance.now();
        // MediaPipe VIDEO mode requires strictly increasing integer millisecond timestamps
        const detectTs = Math.max(
          lastDetectTsRef.current + 1,
          Math.round(nowMs)
        );
        lastDetectTsRef.current = detectTs;

        const result = landmarker.detectForVideo(video, detectTs);
        const landmarks = result.faceLandmarks[0];

        if (landmarks && landmarks.length >= 430) {
          ctx.drawImage(video, 0, 0, SAMPLE_CANVAS_WIDTH, SAMPLE_CANVAS_HEIGHT);

          const foreheadBox = computeLandmarkBox(landmarks, FOREHEAD_LANDMARKS);
          const leftCheekBox = computeLandmarkBox(landmarks, LEFT_CHEEK_LANDMARKS);
          const rightCheekBox = computeLandmarkBox(landmarks, RIGHT_CHEEK_LANDMARKS);
          const faceBounds = computeFaceBounds(landmarks);

          const forehead = extractMeanRgbFromBox(
            ctx,
            foreheadBox,
            SAMPLE_CANVAS_WIDTH,
            SAMPLE_CANVAS_HEIGHT
          );
          const leftCheek = extractMeanRgbFromBox(
            ctx,
            leftCheekBox,
            SAMPLE_CANVAS_WIDTH,
            SAMPLE_CANVAS_HEIGHT
          );
          const rightCheek = extractMeanRgbFromBox(
            ctx,
            rightCheekBox,
            SAMPLE_CANVAS_WIDTH,
            SAMPLE_CANVAS_HEIGHT
          );

          // Scale-invariant head velocity normalized by inter-ocular distance
          const nose = landmarks[NOSE_TIP_IDX];
          const lEye = landmarks[LEFT_EYE_INNER_IDX];
          const rEye = landmarks[RIGHT_EYE_INNER_IDX];
          const interOcular = Math.max(
            0.02,
            Math.hypot(lEye.x - rEye.x, lEye.y - rEye.y)
          );

          let headVelocity = 0;
          const prev = prevAnchorRef.current;
          if (prev && nowMs > prev.ts) {
            const dtSec = (nowMs - prev.ts) / 1000;
            const displacement = Math.hypot(nose.x - prev.x, nose.y - prev.y);
            headVelocity = displacement / interOcular / Math.max(dtSec, 0.001);
          }
          prevAnchorRef.current = { x: nose.x, y: nose.y, ts: nowMs };

          const sample: RoiRgbSample = {
            timestampMs: nowMs,
            forehead,
            leftCheek,
            rightCheek,
            headVelocity,
          };

          latestSampleRef.current = sample;
          onSampleRef.current?.(sample);

          // Throttle React overlay box state to ~15 Hz to keep main thread light
          if (nowMs - lastUiSyncRef.current > 66) {
            lastUiSyncRef.current = nowMs;
            setFaceDetected(true);
            setRoiBoxes({
              forehead: foreheadBox,
              leftCheek: leftCheekBox,
              rightCheek: rightCheekBox,
              faceBounds,
            });
          }
        } else {
          prevAnchorRef.current = null;
          if (nowMs - lastUiSyncRef.current > 120) {
            lastUiSyncRef.current = nowMs;
            setFaceDetected(false);
            setRoiBoxes(null);
          }
        }
      }

      rafId = requestAnimationFrame(processFrame);
    };

    rafId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isTrackingActive, videoRef]);

  return {
    modelStatus,
    modelError,
    faceDetected: isTrackingActive ? faceDetected : false,
    roiBoxes: isTrackingActive ? roiBoxes : null,
    latestSampleRef,
  };
}
