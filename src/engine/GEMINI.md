# Engine Rules (Dev 1)
- Pure TypeScript math and DSP only. Never import React, DOM APIs, or browser `window` objects here.
- Minimize garbage collection inside per-frame loops (reuse `Float32Array` buffers where possible).
- All outputs must strictly conform to `VitalTelemetry` in `src/types/telemetry.ts`.