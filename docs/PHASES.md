# PulseCam Build Phases (Nov 26 – Dec 7, 2026)

## AI Execution Rules
- Work strictly on **one phase and one dev track** at a time.
- Never skip ahead to future phases.
- Mark tasks `[x]` only after `npx tsc --noEmit` passes and the feature is verified in the browser.

---

## Phase 0: Setup & Contract Lock (Day 1 — Nov 26)
**Goal:** Both devs have a running repo with frozen TypeScript contracts.
- [x] **Shared:** Initialize Next.js (App Router, TS, Tailwind, Shadcn UI, `npm`), install `@mediapipe/tasks-vision`, and push `main`.
- [x] **Shared:** Create `src/types/telemetry.ts` matching `docs/CONTRACTS.md` and lock it.
- [x] **Dev 1:** Scaffold `src/workers/rppg.worker.ts` and `src/engine/` folder + `src/engine/GEMINI.md`.
- [x] **Dev 2:** Configure dark clinical color tokens in `globals.css`, load monospace font (`tabular-nums`), and scaffold `src/components/GEMINI.md`.
- **Gate:** `npm run dev` and `npx tsc --noEmit` succeed on both machines.

---

## Phase 1: Parallel Core Build (Days 2–3 — Nov 27–28)
**Goal:** Engine math works on synthetic data; UI works on mock data. Zero blocking.
- [x] **Dev 1 (Engine):** Implement ring buffer (15–30s sliding window), POS (Plane-Orthogonal-to-Skin) projection, 0.7–3.0 Hz bandpass filter, and 1024-pt FFT for BPM.
- [x] **Dev 1 (Engine):** Write a quick test script feeding a synthetic 72 BPM sine wave into the worker to verify accuracy within ±1 BPM.
- [ ] **Dev 2 (Interface):** Build `useWebcam.ts` and `useFaceMesh.ts` to extract `RoiRgbSample` (forehead + left/right cheeks + head velocity).
- [ ] **Dev 2 (Interface):** Build the `100dvh` mobile-first Clinical HUD, 60 FPS `<canvas>` PPG waveform, and a temporary `useMockTelemetry.ts` hook.
- **Gate:** Dev 1 passes synthetic BPM test; Dev 2 renders a smooth 60 FPS HUD on desktop and mobile viewports.

---

## Phase 2: Live rPPG Integration (Days 4–5 — Nov 29–30)
**Goal:** Replace mock telemetry with real webcam-to-worker heart rate.
- [ ] **Both:** Connect `useFaceMesh.ts` output (`RoiRgbSample`) to `rppg.worker.ts` via `postMessage`.
- [ ] **Both:** Verify live PPG waveform and BPM lock on a real face within 10–15 seconds.
- [ ] **Dev 2:** Add face-alignment reticle and ROI debug toggle (great for the demo video).
- **Gate:** Real webcam produces a stable BPM reading with DevTools Network tab showing 0 bytes uploaded.

---

## Phase 3: Winning Differentiators (Days 6–7 — Dec 1–2)
**Goal:** Ship the technical depth that beats generic hackathon apps.
- [ ] **Dev 1 (Engine):** Add SNR-based SQI (0–100) and head-velocity motion gating (`status: "low_light" | "motion_detected" | "locked"`).
- [ ] **Dev 1 (Engine):** Add CIE-Lab ITA skin-tone estimation and adaptive channel gain (`skinToneCalibrationActive`).
- [ ] **Dev 1 (Engine):** Add peak-to-peak IBI extraction for HRV (RMSSD) and 0.1–0.4 Hz bandpass for Respiratory Rate.
- [ ] **Dev 2 (Interface):** Wire HUD gating alerts (*"Hold still"*, *"Move toward light"*), frozen-reading states, and the **"Adaptive Skin-Tone Calibration Active"** badge.
- [ ] **Dev 2 (Interface):** Add HRV (ms) and Respiratory Rate (br/min) cards to the telemetry sheet.
- **Gate:** Moving head or covering light immediately freezes BPM and triggers the HUD prompt; holding still locks all 3 vitals.

---

## Phase 4: Benchmark Mode & Pre-Triage Report (Days 8–9 — Dec 3–4)
**Goal:** Build the proof-of-accuracy drawer and clinician export.
- [ ] **Dev 1 (Engine):** Build `src/lib/triage.ts` (client-side wellness/stress interpretation + strict non-diagnostic medical disclaimers).
- [ ] **Dev 1 (Engine):** Build `src/lib/pdf.ts` to export a clean, single-page Pre-Triage Summary PDF (BPM, HRV, RR, SQI, timestamp, disclaimers).
- [ ] **Dev 2 (Interface):** Build the toggleable **Benchmark Mode** drawer (input smartwatch/oximeter BPM, compute live MAE, render side-by-side comparison).
- [ ] **Dev 2 (Interface):** Build the 30-second scan completion modal with one-click PDF download.
- **Gate:** Full 30-second scan completes end-to-end, exports a clean PDF, and logs MAE against your smartwatch/oximeter.

---

## Phase 5: Polish, Validation & Submission (Days 10–11 — Dec 5–7)
**Goal:** Production-ready deployment and 1st-place Devpost submission.
- [ ] **Both:** Test on mobile browsers (Android Chrome / iOS Safari) and across different lighting and skin tones.
- [ ] **Dev 2:** Deploy to Vercel and verify HTTPS webcam permissions.
- [ ] **Both:** Record 2-minute demo video: live scan + smartwatch Benchmark Mode proof + DevTools Network tab (0 bytes sent) + PDF export.
- [ ] **Both:** Submit on `https://slayy-hacks.devpost.com/` before the Dec 7 deadline.