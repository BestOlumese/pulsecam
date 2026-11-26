# Architecture & Team Ownership

## Tech Stack
- Next.js (App Router), TypeScript (strict), Tailwind CSS, Shadcn UI (`npm`)
- Computer Vision: `@mediapipe/tasks-vision` (Face Landmarker, client-side)
- Signal Processing: TypeScript Web Worker (`src/workers/rppg.worker.ts`)
- Rendering: HTML5 `<canvas>` (`requestAnimationFrame`) for 60 FPS PPG waveform

## Folder Ownership (Zero-Conflict Rule)
- **Dev 1 (Engine):** `src/engine/*`, `src/workers/*`, `src/lib/triage.ts`, `src/lib/pdf.ts`
  - Owns: POS algorithm, bandpass filtering (0.7–3.0 Hz HR, 0.1–0.4 Hz RR), 1024-pt FFT, HRV (RMSSD), CIE-Lab skin-tone calibration, SNR/SQI gating.
- **Dev 2 (Interface):** `src/app/*`, `src/components/*`, `src/hooks/useWebcam.ts`, `src/hooks/useFaceMesh.ts`
  - Owns: Webcam stream, MediaPipe ROI extraction (forehead + cheeks), Clinical HUD, live waveform canvas, Benchmark Mode UI, mobile layout.
- **Shared (Edit only by agreement):** `src/types/telemetry.ts`, `package.json`

## Git Workflow
- Branch naming: `feat/dev1-<feature>` and `feat/dev2-<feature>`.
- Never push directly to `main`. Merge small PRs daily.