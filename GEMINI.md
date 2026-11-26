# PulseCam — SLAY HACKS 2026
Zero-hardware, 100% client-side rPPG vital signs pre-triage web app (Heart Rate, HRV, Respiratory Rate) running in the browser via webcam.

## Commands
- Dev server: `npm run dev`
- Type check: `npx tsc --noEmit`
- Lint: `npm run lint`
- Build: `npm run build`

## Core Specs
@./docs/ARCHITECTURE.md
@./docs/DESIGN_SYSTEM.md
@./docs/CONTRACTS.md
@./docs/PHASES.md

## Hard Boundaries
- **Zero Cloud Video:** Never send webcam frames, video streams, or PII to any backend or external API. All rPPG/DSP runs 100% client-side.
- **No Slop:** Follow `DESIGN_SYSTEM.md` strictly. Never generate generic SaaS hero sections, marketing copy, or purple-gradient cards.
- **Respect Ownership:** Check `ARCHITECTURE.md` before editing files outside your assigned directory.
- **Verify:** Run `npx tsc --noEmit` before finishing any task.