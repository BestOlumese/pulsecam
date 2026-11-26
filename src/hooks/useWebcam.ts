"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WebcamStatus = "idle" | "requesting" | "ready" | "error";

export interface UseWebcamResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: WebcamStatus;
  errorMessage: string | null;
  isActive: boolean;
  startWebcam: () => Promise<void>;
  stopWebcam: () => void;
}

/**
 * Client-side webcam stream hook (100% local — never transmitted over the network).
 * Requests a front-facing 640x480@30fps stream with clean track teardown on unmount.
 */
export function useWebcam(autoStart = false): UseWebcamResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<WebcamStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stopWebcam = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (mountedRef.current) {
      setStatus("idle");
      setErrorMessage(null);
    }
  }, []);

  const startWebcam = useCallback(async () => {
    if (streamRef.current) {
      setStatus("ready");
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setStatus("error");
      setErrorMessage("Camera API unavailable in this browser or context (HTTPS required).");
      return;
    }

    setStatus("requesting");
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      if (!mountedRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      if (mountedRef.current) {
        setStatus("ready");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission denied. Allow webcam access to scan."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No webcam detected on this device."
            : "Unable to initialize webcam stream.";
      setStatus("error");
      setErrorMessage(message);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let rafId = 0;
    if (autoStart) {
      rafId = requestAnimationFrame(() => {
        void startWebcam();
      });
    }
    return () => {
      cancelAnimationFrame(rafId);
      mountedRef.current = false;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
    };
  }, [autoStart, startWebcam]);

  return {
    videoRef,
    status,
    errorMessage,
    isActive: status === "ready",
    startWebcam,
    stopWebcam,
  };
}
