export default function Home() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-background text-foreground flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 space-y-5">
        <header className="flex items-center justify-between border-b border-border pb-4">
          <div className="space-y-1">
            <h1 className="text-sm font-medium tracking-wide uppercase text-foreground">
              PulseCam
            </h1>
            <p className="text-xs text-muted-foreground">
              Client-Side rPPG Telemetry — Phase 0 Shell
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs tabular-nums text-signal-good">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-good" />
            SQI 0%
          </span>
        </header>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              HR
            </p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-pulse-accent">
              --
            </p>
            <p className="text-[11px] text-muted-foreground">BPM</p>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              HRV
            </p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-foreground">
              --
            </p>
            <p className="text-[11px] text-muted-foreground">ms</p>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              RR
            </p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-foreground">
              --
            </p>
            <p className="text-[11px] text-muted-foreground">br/min</p>
          </div>
        </div>

        <p className="text-xs text-signal-warn">
          Idle — awaiting Phase 1 webcam &amp; DSP integration.
        </p>
      </section>
    </main>
  );
}
