# PulseCam Design System — Clinical Dark Telemetry

## Aesthetic & Layout
- **App-First:** `/` loads directly into the live Biometric Scanner HUD. NO SaaS hero sections, NO feature grids, NO testimonials, NO footer links.
- **Mobile-First Viewport (`100dvh`):** No vertical page scrolling during a scan.
  - **Mobile:** Top 55% = live webcam viewfinder with subtle face-alignment reticle & ROI overlay; Bottom 45% = pinned telemetry sheet (BPM, HRV, RR, SQI pill, and primary "Start 30s Scan" CTA).
  - **Desktop:** Split-screen telemetry cockpit (Left 60% = viewfinder + live 60 FPS PPG waveform; Right 40% = vitals grid, calibration status, Benchmark drawer).

## Color Tokens (Strict — Do Not Invent New Colors)
- Background Canvas: `#09090B` (Obsidian)
- Elevated Surface / Cards: `#121216` with `1px solid #27272A` hairline border
- Primary Text: `#FAFAFA` | Muted Labels: `#A1A1AA`
- Signal Good (High SQI): `#10B981` (Emerald)
- Warning (Motion / Low Light): `#F59E0B` (Amber)
- Pulse Peak / Waveform Accent: `#F43F5E` (Clinical Rose)

## Typography & Components
- **Numbers:** Always use `font-mono tabular-nums` for BPM, HRV, RR, SQI%, and countdown timers so digits never shift width.
- **UI Library:** Use Shadcn UI primitives (`Button`, `Sheet`, `Drawer`, `Badge`, `Dialog`, `Tabs`) styled with Tailwind CSS.
- **States:** Every metric card must handle `idle`, `calibrating`, `low_signal` (frozen reading + HUD prompt), and `locked` states cleanly.
- **Banned Patterns:** No neon drop-shadows, no glassmorphism overuse, no stock illustrations, no generic purple/blue gradients.