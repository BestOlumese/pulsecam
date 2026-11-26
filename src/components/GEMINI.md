# Interface Rules (Dev 2)
- Use Shadcn UI primitives styled with Tailwind CSS and the exact hex tokens from `docs/DESIGN_SYSTEM.md`.
- Keep the live scanner locked to `100dvh` with zero vertical page scrolling on mobile.
- Apply `font-mono tabular-nums` to every live numeric readout.
- Never run heavy DSP math on the main React thread; consume telemetry from the Web Worker or `useMockTelemetry`.