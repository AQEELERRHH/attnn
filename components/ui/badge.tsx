import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-arc-bg-3 text-text-primary border border-border-bright",
        secondary: "bg-arc-bg-2 text-text-secondary border border-border-bright",
        destructive: "bg-arc-coral/10 text-arc-coral border border-arc-coral/30",
        success: "bg-green/10 text-green border border-green/30",
        gold: "bg-arc-gold/10 text-arc-gold border border-arc-gold/35",
        outline: "text-text-primary border border-border-bright",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
