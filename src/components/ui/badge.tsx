import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap select-none",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        good: "border-signal-good/40 bg-signal-good/10 text-signal-good",
        warn: "border-signal-warn/40 bg-signal-warn/10 text-signal-warn",
        pulse: "border-pulse-accent/40 bg-pulse-accent/10 text-pulse-accent",
        muted: "border-border bg-background text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
